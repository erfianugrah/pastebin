-- Reinstate the Realtime broadcast pipeline for the live /recent feed.
--
-- Migration 20260512102410_drop_realtime_broadcast.sql removed the
-- broadcast_public_paste_insert() trigger + function + the realtime.messages
-- RLS policies, because the feature never shipped (no frontend subscriber,
-- CSP blocked wss://<ref>.supabase.co, zero-subscriber quota burn).
--
-- It ships now via a Durable Object relay (feat/realtime-recent-do): the
-- browser subscribes to a SAME-ORIGIN WebSocket on the Worker; a Durable
-- Object holds the single upstream Supabase Realtime subscription server-side
-- and fans out. So the CSP stays `connect-src 'self'`, the anon key never
-- reaches the browser, and the BFF invariant holds. See
-- docs/plans/2026-07-14-realtime-recent-do.md.
--
-- This migration re-adds exactly what the drop removed. The three
-- defense-in-depth layers are unchanged from 20260511132703:
--   1. Trigger filters visibility = 'public' before doing anything.
--   2. Payload carries ONLY safe metadata (mirrors /api/recent).
--   3. Private channel + RLS on realtime.messages scopes anon/authenticated
--      to the exact topic 'recent:public', broadcast extension only.

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
  -- Excludes content, delete_token, user_id (sensitive); E2EE keys are
  -- not in the DB at all (URL fragment only).
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
-- AFTER INSERT only. read-count upserts (INSERT ... ON CONFLICT DO UPDATE)
-- fire the UPDATE path, not this trigger.

DROP TRIGGER IF EXISTS broadcast_public_paste_insert_trigger ON public.pastes;
CREATE TRIGGER broadcast_public_paste_insert_trigger
  AFTER INSERT ON public.pastes
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_public_paste_insert();

-- ---- Layer 3: RLS policies on realtime.messages ----
-- Private channels require a SELECT policy on realtime.messages to receive.
-- Restrict to the exact topic 'recent:public' and broadcast extension only.

DROP POLICY IF EXISTS "anon can receive recent:public broadcasts" ON realtime.messages;
CREATE POLICY "anon can receive recent:public broadcasts"
  ON realtime.messages
  FOR SELECT
  TO anon
  USING (
    realtime.topic() = 'recent:public'
    AND extension = 'broadcast'
  );

DROP POLICY IF EXISTS "authenticated can receive recent:public broadcasts" ON realtime.messages;
CREATE POLICY "authenticated can receive recent:public broadcasts"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() = 'recent:public'
    AND extension = 'broadcast'
  );
