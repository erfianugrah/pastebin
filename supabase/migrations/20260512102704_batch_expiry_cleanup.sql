-- Batch the expiry cleanup pg-cron jobs to bound lock-hold time.
--
-- Migration 20260412074417_schedule_cleanup_jobs.sql scheduled:
--   cleanup-expired-pastes  every 5 min  → DELETE FROM pastes WHERE expires_at < now()
--   cleanup-expired-slugs   daily        → DELETE FROM slugs  WHERE expires_at < now()
--
-- Both DELETEs are unbounded. If a spike of 1-hour pastes expires in a
-- single window (e.g. 50k rows), the unbatched DELETE takes a single
-- exclusive lock on every row in the matching set. Live reads/writes that
-- touch overlapping rows (e.g. concurrent `view_paste(uuid)` calls on a
-- paste mid-burn) stall behind the lock until the DELETE completes.
--
-- Rewrite to a bounded batch: each invocation deletes at most 1000 rows.
-- pg-cron will fire the job again 5 min later; the next run picks up where
-- this one left off. Worst case the cleanup spreads across multiple cycles
-- — that's fine, the rows are already past-expiry and not user-visible
-- (every read path filters `expires_at > now()`).
--
-- Slug cleanup gets the same treatment and bumps from daily to every 15
-- minutes — daily was based on slugs being a long-tail thing, but with
-- batching we can amortise the work across more frequent runs.

-- Unschedule the unbounded jobs.
SELECT cron.unschedule('cleanup-expired-pastes');
SELECT cron.unschedule('cleanup-expired-slugs');

-- Schedule batched replacements. The IN (SELECT ... LIMIT 1000) pattern
-- lets Postgres take the LIMIT inside a subquery so the DELETE acquires
-- at most 1000 row locks.
SELECT cron.schedule(
  'cleanup-expired-pastes',
  '*/5 * * * *',
  $$
    DELETE FROM public.pastes
    WHERE id IN (
      SELECT id FROM public.pastes
      WHERE expires_at < now()
      LIMIT 1000
    )
  $$
);

SELECT cron.schedule(
  'cleanup-expired-slugs',
  '*/15 * * * *',
  $$
    DELETE FROM public.slugs
    WHERE slug IN (
      SELECT slug FROM public.slugs
      WHERE expires_at < now()
      LIMIT 1000
    )
  $$
);
