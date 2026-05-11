-- view_paste(): atomic view with burn-after-reading and view-limit enforcement.
--
-- Replaces the multi-step read flow in getPasteQuery.execute():
--   1. SELECT *                              (read row)
--   2. UPDATE read_count = read_count + 1    (bump)
--   3. IF burn_after_reading THEN DELETE     (clean up)
--
-- The race: two concurrent reads of a burn_after_reading paste can BOTH
-- pass step 1 with read_count = 0, BOTH bump to 1, BOTH serve the content,
-- then BOTH delete. Content served twice instead of once. KV has no row-
-- level locking primitive so this race is unfixable there.
--
-- This function acquires a row lock with SELECT ... FOR UPDATE. Concurrent
-- callers serialize on the lock; only one gets the burn, the rest see the
-- paste already gone and return 0 rows.
--
-- Returns:
--   0 rows = paste not found, expired, or already-at-view-limit (the row
--            is cleaned up in the last two cases). API layer maps to 404.
--   1 row  = paste was visible to this caller. was_burned/was_view_limited
--            indicate whether the row was deleted as part of this view.
--
-- Security: SECURITY DEFINER + SET search_path = '' is the standard pattern
-- for functions that operate on user data. Even though the Worker calls
-- this with service_role (which bypasses RLS anyway), defining the function
-- securely means future authenticated callers can use it without risk.
-- search_path = '' forces fully-qualified names everywhere -- no schema-
-- shadowing privilege-escalation tricks possible.

CREATE OR REPLACE FUNCTION public.view_paste(paste_uuid uuid)
RETURNS TABLE (
  paste_data jsonb,
  was_burned boolean,
  was_view_limited boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.pastes%ROWTYPE;
BEGIN
  -- Acquire row lock. Concurrent callers block here until the first
  -- transaction commits or rolls back. NOWAIT/SKIP LOCKED not used --
  -- we want callers to wait so they see the correct post-burn state.
  SELECT * INTO p FROM public.pastes WHERE id = paste_uuid FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Already expired? pg_cron may not have cleaned it yet (5-min lag).
  -- Delete it now (we hold the lock) and treat as not-found.
  IF p.expires_at < now() THEN
    DELETE FROM public.pastes WHERE id = paste_uuid;
    RETURN;
  END IF;

  -- View limit already reached from a prior call that returned but didn't
  -- delete (defensive -- shouldn't happen with this function, but covers
  -- the case where a paste was created with read_count >= view_limit).
  IF p.view_limit IS NOT NULL AND p.read_count >= p.view_limit THEN
    DELETE FROM public.pastes WHERE id = paste_uuid;
    RETURN;
  END IF;

  -- This view counts. Increment.
  UPDATE public.pastes
    SET read_count = read_count + 1
    WHERE id = paste_uuid
    RETURNING * INTO p;

  -- Burn after reading: lock guarantees we're the only caller to reach
  -- this branch for this row. The DELETE inside the same transaction
  -- means concurrent waiters will see NOT FOUND when they acquire the
  -- lock after us.
  IF p.burn_after_reading THEN
    DELETE FROM public.pastes WHERE id = paste_uuid;
    paste_data := to_jsonb(p);
    was_burned := true;
    was_view_limited := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- This view hit the view limit. Serve content + delete row.
  IF p.view_limit IS NOT NULL AND p.read_count >= p.view_limit THEN
    DELETE FROM public.pastes WHERE id = paste_uuid;
    paste_data := to_jsonb(p);
    was_burned := false;
    was_view_limited := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Normal view, paste persists.
  paste_data := to_jsonb(p);
  was_burned := false;
  was_view_limited := false;
  RETURN NEXT;
END;
$$;

-- Lock down execution permissions. The Worker uses service_role which has
-- access to everything by default. Explicitly granting here means if/when
-- we expose this to anon or authenticated, the grant is intentional.
REVOKE EXECUTE ON FUNCTION public.view_paste(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.view_paste(uuid) TO service_role;
