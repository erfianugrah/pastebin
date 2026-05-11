-- Phase 4.4: RLS policies for authenticated users.
--
-- Until now, the only RLS policies on `pastes` and `slugs` were for the
-- `anon` role:
--   - public pastes are viewable by anyone (anon SELECT)
--   - visible vanity slugs (anon SELECT non-expired)
--
-- The Worker bypasses RLS (uses service_role) so these are
-- defense-in-depth. Phase 4.4 introduces user accounts via Supabase
-- Auth and adds RLS policies for the `authenticated` role.
--
-- Worker behavior is unchanged. The new policies matter when:
--   - The frontend queries Supabase directly with a user's JWT
--     (e.g. the /my page lists the user's pastes by querying through RLS)
--   - Future endpoints run under authenticated context
--   - Anything bypasses the Worker (defense in depth)
--
-- Policy structure (multiple SELECT policies combine with OR):
--
--   - "authenticated can view public pastes": same as anon policy,
--      so authenticated users see the public pastes feed correctly
--      via the frontend
--   - "authenticated can view own pastes": user's own pastes
--      regardless of visibility (the /my page)
--   - "authenticated can create own pastes": INSERT with WITH CHECK
--      forcing user_id = auth.uid(). Can't impersonate.
--   - "authenticated can update own pastes": USING + WITH CHECK both
--      pin to auth.uid() so user can't reassign rows to another user
--   - "authenticated can delete own pastes": deletes own rows
--
-- Performance: every policy uses `(SELECT auth.uid())` not bare
-- `auth.uid()`. This lets Postgres compute auth.uid() once per
-- statement via initPlan instead of once per row. Big difference at
-- scale (94-99% improvement per Supabase RLS-Performance benchmarks).
--
-- `idx_user_pastes` (partial btree on user_id WHERE user_id IS NOT NULL)
-- is already in place from Phase 0 and supports the
-- `user_id = (select auth.uid())` predicate efficiently.

-- ---- SELECT policies ----

CREATE POLICY "authenticated can view public pastes"
  ON public.pastes
  FOR SELECT
  TO authenticated
  USING (visibility = 'public');

CREATE POLICY "authenticated can view own pastes"
  ON public.pastes
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ---- INSERT policy ----
--
-- WITH CHECK ensures the inserting user can only create pastes assigned
-- to themselves. They cannot insert a row with a different user_id.
-- They CAN insert with user_id = NULL (anonymous paste), since
-- NULL = auth.uid() is NULL, which is not TRUE -- so this is rejected.
-- To explicitly allow authenticated users to also create anonymous
-- pastes, we'd need `WITH CHECK (user_id IS NULL OR (SELECT auth.uid()) = user_id)`.
-- For now require authenticated inserts to assign user_id; the Worker's
-- service_role path still handles anonymous pastes.

CREATE POLICY "authenticated can create own pastes"
  ON public.pastes
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ---- UPDATE policy ----
--
-- USING: row must already belong to the user
-- WITH CHECK: the NEW row must also belong to the user (prevents
--             reassigning user_id to someone else mid-update)
-- An UPDATE policy requires a SELECT policy to also be in place
-- (Postgres needs to find the row before updating). The two SELECT
-- policies above cover this.

CREATE POLICY "authenticated can update own pastes"
  ON public.pastes
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ---- DELETE policy ----

CREATE POLICY "authenticated can delete own pastes"
  ON public.pastes
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ---- Slugs ----
--
-- The slugs table has no user_id column. Slug ownership is implicit
-- via paste_id -> pastes(user_id). For authenticated users to manage
-- slugs we'd need either a join in the policy (anti-pattern, slow) or
-- duplicate user_id onto slugs. Defer this until the UI needs it; the
-- Worker (service_role) handles all slug operations today.
