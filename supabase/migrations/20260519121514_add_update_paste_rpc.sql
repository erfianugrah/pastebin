-- update_paste(): atomic paste update with token check.
--
-- Replaces the read-modify-write flow that handleUpdatePaste used to do:
--   1. SELECT * (no lock)
--   2. build new Paste in memory with snapshot read_count
--   3. .upsert() the whole row
--
-- That flow had two race-condition bugs:
--   a. If `view_paste()` incremented `read_count` between (1) and (3),
--      the upsert clobbered the increment with the stale snapshot.
--   b. Worse: if `view_paste()` burned (DELETEd) the row between (1)
--      and (3), the upsert's INSERT branch fired and **resurrected the
--      burned paste** with new content + read_count=0. That defeats
--      burn-after-reading entirely for any update racing a burn.
--
-- update_paste() takes a FOR UPDATE row lock and does a partial UPDATE
-- (only content/title/language). The lock serialises against any
-- concurrent view_paste() so burn-resurrection is impossible: either
-- the burn wins (we see NOT FOUND, return was_found=false) or the
-- update wins (the row is still there, partial update applies).
--
-- Returns one row with two booleans:
--   was_found   — the paste id existed (regardless of token match)
--   was_updated — the token matched AND the row was updated
--
-- Caller maps:
--   was_found=false, was_updated=false → 404 not_found
--   was_found=true,  was_updated=false → 403 unauthorized
--   was_found=true,  was_updated=true  → 200 ok
--
-- Partial-update semantics: NULL arg means "leave column unchanged".
-- Callers send NULL for fields they don't want to touch. `content` is
-- NOT NULL in the schema, so passing NULL for content is harmless
-- (UPDATE keeps the existing value via COALESCE).
--
-- The `read_count` and `view_limit` and `burn_after_reading` columns
-- are NEVER touched by this function — those are owned by view_paste()
-- and the create path. Updating them here would re-introduce the
-- clobbering race.
--
-- Security: SECURITY DEFINER + SET search_path = '', same pattern as
-- view_paste() and delete_paste(). Granted to service_role only.

CREATE OR REPLACE FUNCTION public.update_paste(
  paste_uuid uuid,
  owner_token uuid,
  new_content text,
  new_title text,
  new_language text
)
RETURNS TABLE (
  was_found boolean,
  was_updated boolean
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
    was_updated := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF stored_token IS NULL OR stored_token <> owner_token THEN
    was_found := true;
    was_updated := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- COALESCE: NULL arg → keep existing value. content is NOT NULL so
  -- COALESCE(NULL, content) keeps the column intact. title can be NULL
  -- in the schema (post 20260511180117_title_nullable.sql) — passing
  -- NULL means "no change", not "clear it".
  UPDATE public.pastes
    SET content = COALESCE(new_content, content),
        title = COALESCE(new_title, title),
        language = COALESCE(new_language, language)
    WHERE id = paste_uuid;

  was_found := true;
  was_updated := true;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_paste(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_paste(uuid, uuid, text, text, text) TO service_role;
