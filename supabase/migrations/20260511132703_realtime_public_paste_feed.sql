-- Realtime broadcast: live feed of newly-created public pastes.
--
-- Paste model has two orthogonal dimensions: visibility (public|private)
-- and encryption (plaintext | client-side E2EE). Four combinations:
--   1. public + plaintext           -> broadcast metadata (mirrors /api/recent)
--   2. public + encrypted (E2EE)    -> broadcast metadata; title may itself
--                                      be ciphertext (client's choice), but
--                                      broadcasting it is harmless -- the
--                                      content key lives only in the URL
--                                      fragment (#hash), never on the server
--   3. private + plaintext          -> NEVER broadcast (trigger filter)
--   4. private + encrypted          -> NEVER broadcast (trigger filter)
--
-- Sensitive fields by category:
--   - `content`              -- plaintext OR ciphertext, never for broadcast
--   - `delete_token`         -- secret, never for broadcast
--   - `user_id`              -- privacy (Phase 4.4 adds auth), never for broadcast
--   - E2EE encryption key    -- not in DB at all (URL fragment only)
--   - Passwords              -- removed entirely in Phase 4 cleanup
--
-- Safe metadata (already exposed via /api/recent):
--   id, title, language, created_at, expires_at, read_count,
--   is_encrypted (boolean), version (int: 0=plaintext, 2=E2EE)
--
-- Three defense-in-depth layers ensure private pastes and sensitive
-- fields never leak to subscribers:
--
--   1. Trigger filters visibility = 'public' before doing anything.
--      Private pastes never reach realtime.send().
--   2. Payload includes ONLY safe metadata fields. The trigger is the
--      single source of truth for what gets broadcast; sensitive columns
--      cannot reach the wire even if the schema gains new fields.
--   3. Channel is private (is_private = true). RLS policy on
--      realtime.messages restricts anon to the exact topic 'recent:public'.
--      A future trigger bug broadcasting elsewhere couldn't reach anon.
--
-- Why INSERT only (not UPDATE/DELETE):
--   - Live feed shows "newly created pastes". UPDATE events fire on every
--     read_count increment -- noise.
--   - DELETE events from the pg_cron cleanup job would broadcast lots of
--     expirations at once -- also noise.
--   - If we ever want delete events, add a separate trigger with a
--     separate topic so subscribers can opt in.
--
-- Why a single global topic ('recent:public') instead of per-paste topics:
--   - The feed is "all new public pastes" -- one stream, many subscribers.
--   - Per-paste topics would require subscribers to know paste IDs in
--     advance, defeating the purpose.

-- ---- Trigger function ----

CREATE OR REPLACE FUNCTION public.broadcast_public_paste_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Layer 1: only public pastes broadcast at all.
  IF NEW.visibility <> 'public' THEN
    RETURN NULL;
  END IF;

  -- Layer 2: curated payload. Mirrors the shape of /api/recent so the
  -- frontend can prepend it to the existing list without remapping.
  -- Includes encryption metadata (is_encrypted, version) so the UI can
  -- render the same encrypted-badge it shows on /api/recent. Excludes:
  -- content, delete_token, user_id (sensitive); E2EE keys (not in DB).
  PERFORM realtime.send(
    jsonb_build_object(
      'id', NEW.id,
      'title', coalesce(NEW.title, 'Untitled Paste'),
      'language', NEW.language,
      'createdAt', NEW.created_at,
      'expiresAt', NEW.expires_at,
      'readCount', NEW.read_count,
      'isEncrypted', NEW.is_encrypted,
      'version', NEW.version
    ),
    'paste_created',  -- event name (clients filter on this)
    'recent:public',  -- topic (single global feed)
    true              -- is_private = true (Layer 3 below enforces)
  );

  RETURN NULL;
END;
$$;

-- ---- Trigger ----
--
-- AFTER INSERT only. Postgres distinguishes INSERT triggers from UPDATE
-- triggers even when the SQL was an `INSERT ... ON CONFLICT DO UPDATE`
-- (read-count upserts won't fire this).

CREATE TRIGGER broadcast_public_paste_insert_trigger
  AFTER INSERT ON public.pastes
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_public_paste_insert();

-- ---- Layer 3: RLS policy on realtime.messages ----
--
-- Private channels require a SELECT policy on realtime.messages to receive.
-- Restrict anon to the exact topic 'recent:public' and only broadcast
-- messages (not presence or postgres_changes). If the trigger or some
-- other code path broadcast to a different topic, anon couldn't receive.
--
-- realtime.topic() returns the topic string of the current subscription.
-- realtime.messages.extension distinguishes 'broadcast' vs 'presence'.

CREATE POLICY "anon can receive recent:public broadcasts"
  ON realtime.messages
  FOR SELECT
  TO anon
  USING (
    realtime.topic() = 'recent:public'
    AND extension = 'broadcast'
  );

-- Same for authenticated users (so Phase 4.4 doesn't break Realtime).
CREATE POLICY "authenticated can receive recent:public broadcasts"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() = 'recent:public'
    AND extension = 'broadcast'
  );
