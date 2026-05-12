-- Drop the dead Realtime broadcast pipeline.
--
-- Migration 20260511132703_realtime_public_paste_feed.sql installed a trigger
-- that fires `realtime.send(...)` on every public-paste INSERT. The plan was
-- a "newly-created pastes" live feed on /recent that pushed inserts to the
-- frontend over a WebSocket.
--
-- That feature never shipped. Verification (May 2026):
--   - `astro/src/` contains zero `supabase-js` client instances, zero
--     `.channel(...)` calls, zero `.subscribe(...)` calls.
--   - CSP in src/interfaces/api/middleware.ts is `connect-src 'self'` —
--     WebSocket to `wss://<ref>.supabase.co` is physically blocked by the
--     browser regardless of any future code change.
--   - Every public paste insert therefore enqueues a message into Realtime
--     that has zero subscribers. Free plan caps Realtime at 2M messages/mo.
--
-- Removing the trigger + RLS policies eliminates that quota burn. The
-- frontend currently polls `GET /api/recent` once per page load (no
-- setInterval); polling-based UX is unaffected.
--
-- To re-enable later: revert this migration AND
--   1. add `wss://*.supabase.co` to the CSP `connect-src` directive,
--   2. instantiate a supabase-js client on the frontend with the publishable
--      (anon) key,
--   3. subscribe via `client.channel('recent:public').on('broadcast', ...)`.

-- ---- Drop the trigger first (depends on the function) ----
DROP TRIGGER IF EXISTS broadcast_public_paste_insert_trigger ON public.pastes;

-- ---- Drop the function ----
DROP FUNCTION IF EXISTS public.broadcast_public_paste_insert();

-- ---- Drop the RLS policies on realtime.messages ----
-- These restricted anon/authenticated to the exact topic 'recent:public'.
-- With the trigger gone, no broadcasts will fire to this topic; clearing
-- the policies keeps realtime.messages clean.
DROP POLICY IF EXISTS "anon can receive recent:public broadcasts" ON realtime.messages;
DROP POLICY IF EXISTS "authenticated can receive recent:public broadcasts" ON realtime.messages;
