-- delete_paste(): atomic paste delete with token check.
--
-- Replaces the two-step `findById + delete` flow in DeletePasteCommand:
--   1. SELECT * to read delete_token         (round-trip 1)
--   2. delete on token-match                  (round-trip 2)
--
-- Single statement + atomicity. Returns one row with two booleans:
--   was_found    — the paste id existed (regardless of token match)
--   was_deleted  — the token matched AND the row was deleted
--
-- Caller distinguishes:
--   was_found = false, was_deleted = false  → 404 not_found
--   was_found = true,  was_deleted = false  → 403 unauthorized
--   was_found = true,  was_deleted = true   → 200 success
--
-- No expired-row branch: expired pastes are cleaned up by pg_cron. If a
-- user deletes an expired paste they get not_found, which is correct.
--
-- TOCTOU note: takes `FOR UPDATE` on the row so two concurrent
-- delete_paste calls with the same valid token serialise — only the
-- first sees the row, second gets `was_found = false`. Same observable
-- behaviour as the old two-step path, but in one round-trip.
--
-- Security: SECURITY DEFINER + SET search_path = '', same pattern as
-- view_paste(). Granted to service_role only.

CREATE OR REPLACE FUNCTION public.delete_paste(paste_uuid uuid, owner_token uuid)
RETURNS TABLE (
  was_found boolean,
  was_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  stored_token uuid;
BEGIN
  SELECT delete_token INTO stored_token
    FROM public.pastes
    WHERE id = paste_uuid
    FOR UPDATE;

  IF NOT FOUND THEN
    was_found := false;
    was_deleted := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF stored_token IS NULL OR stored_token <> owner_token THEN
    was_found := true;
    was_deleted := false;
    RETURN NEXT;
    RETURN;
  END IF;

  DELETE FROM public.pastes WHERE id = paste_uuid;
  was_found := true;
  was_deleted := true;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_paste(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_paste(uuid, uuid) TO service_role;
