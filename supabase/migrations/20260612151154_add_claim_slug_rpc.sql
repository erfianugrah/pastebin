-- claim_slug(): atomic, dead-row-tolerant vanity-slug claim.
--
-- Replaces the plain `INSERT INTO slugs` (+ 23505 catch) used by the old
-- saveSlug path. Two problems with that flow:
--
--   M2 (orphan): the create command saved the paste BEFORE claiming the
--       slug, so a conflict left an orphaned paste row with no URL. (The
--       command now also prechecks + compensating-deletes, but a race can
--       still slip past the precheck.)
--   M3 (expired-slug false 409): resolveSlug filters `expires_at > now()`,
--       so an expired-but-not-yet-reaped slug row reads as "free", then the
--       INSERT hits the still-physically-present row's PK and 23505s — the
--       user gets "already taken" for a slug that is actually available
--       until the pg_cron reaper runs.
--
-- This RPC fixes M3 directly: it UPSERTs over a conflicting row ONLY when
-- that row is already expired. A live conflict updates zero rows and the
-- function reports `claimed = false`; the create command turns that into a
-- clean 409 (and compensating-deletes the just-saved paste).
--
-- Concurrency: two concurrent claims of the same NEW slug serialise on the
-- ON CONFLICT row lock — the loser sees the winner's freshly-inserted LIVE
-- row, the `expires_at < now()` guard excludes it, 0 rows, claimed = false.
-- Same race-safe outcome the 23505 catch used to give, but in one round-trip
-- and without an error.
--
-- Security: SECURITY DEFINER + SET search_path = '', same pattern as
-- view_paste / delete_paste / update_paste. Granted to service_role only.

CREATE OR REPLACE FUNCTION public.claim_slug(
  slug_text text,
  paste_uuid uuid,
  slug_expires_at timestamptz
)
RETURNS TABLE (claimed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.slugs (slug, paste_id, expires_at)
  VALUES (slug_text, paste_uuid, slug_expires_at)
  ON CONFLICT (slug) DO UPDATE
    SET paste_id = EXCLUDED.paste_id,
        expires_at = EXCLUDED.expires_at
    WHERE public.slugs.expires_at < now();

  -- FOUND is true iff the INSERT inserted a row or the DO UPDATE matched
  -- (i.e. the conflicting row was expired). A live conflict updates 0 rows
  -- and leaves FOUND = false without raising.
  claimed := FOUND;
  RETURN NEXT;
END;
$$;

-- BFF lockdown, same as view_paste / delete_paste / update_paste (see
-- 20260608155754_harden_security_definer_grants.sql). Supabase's stock
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon, authenticated`
-- gives every postgres-owned public function a DIRECT execute grant to
-- anon + authenticated at creation, which `REVOKE ... FROM PUBLIC` does NOT
-- remove. The Worker calls this RPC only via service_role, so strip the
-- anon/authenticated grants explicitly or it's callable off /rest/v1/rpc/*
-- with the anon key (linter findings 0028/0029).
REVOKE EXECUTE ON FUNCTION public.claim_slug(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_slug(text, uuid, timestamptz) TO service_role;
