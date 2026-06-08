-- Tighten SECURITY DEFINER RPC execute grants to service_role only, and pin
-- set_updated_at's search_path. Clears these database-linter findings:
--   0011_function_search_path_mutable            (public.set_updated_at)
--   0028_anon_security_definer_function_executable
--   0029_authenticated_security_definer_function_executable
--     (public.view_paste / delete_paste / update_paste / paste_stats)
--
-- ROOT CAUSE of the 0028/0029 warnings:
--   20260407101812_remote_schema.sql runs Supabase's stock
--     ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--       GRANT ALL ON FUNCTIONS TO anon;
--     ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO authenticated;
--   so every function created by `postgres` in `public` receives a DIRECT
--   EXECUTE grant to anon + authenticated at creation time. The per-function
--   `REVOKE EXECUTE ... FROM PUBLIC` in the RPC migrations only dropped the
--   implicit PUBLIC grant -- it never touched those direct anon/authenticated
--   grants, so the roles retained EXECUTE. That is exactly what the linter
--   flags: the functions are callable straight off /rest/v1/rpc/* with the
--   anon key, bypassing the Worker.
--
-- WHY REVOKING IS SAFE: Pasteriser is a BFF. The Worker calls every RPC via
-- service_role (RLS bypass); the browser has no supabase-js client and the
-- CSP `connect-src 'self'` blocks all requests to *.supabase.co. No legitimate
-- caller is ever anon/authenticated. service_role keeps its explicit grant, so
-- the Worker is unaffected.

REVOKE EXECUTE ON FUNCTION public.view_paste(uuid)                           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_paste(uuid, uuid)                    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_paste(uuid, uuid, text, text, text)  FROM anon, authenticated;

-- paste_stats() was previously granted to anon/authenticated on the rationale
-- that it only returns public-visibility aggregates (already exposed via
-- GET /api/recent). Under the BFF pattern nothing calls it directly either, so
-- tighten it to match. If you ever let the browser call it straight from
-- Supabase, re-grant:
--   GRANT EXECUTE ON FUNCTION public.paste_stats() TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.paste_stats()                              FROM anon, authenticated;

-- 0011_function_search_path_mutable: set_updated_at (the BEFORE UPDATE trigger
-- fn) was created without a pinned search_path. Its body only calls now() and
-- touches NEW, and pg_catalog is always searched first regardless of
-- search_path, so '' is safe and resolves now() correctly.
ALTER FUNCTION public.set_updated_at() SET search_path = '';
