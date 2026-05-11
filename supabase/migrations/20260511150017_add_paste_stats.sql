-- Phase 4.5: paste_stats() — aggregate stats over public pastes.
--
-- Returns a jsonb object with four sections:
--
--   totalPublic    int     count of non-expired public pastes
--   byLanguage     array   [{language, count}, ...] top 20, desc
--   byHour         array   [{hour, count}, ...] last 48h, desc
--   encryption     object  { "<version>": count } where version is the
--                          encryption-scheme integer (0 = plaintext,
--                          2 = client-side E2EE; future versions extend)
--
-- All counts exclude expired pastes (`expires_at > now()`) -- pg_cron
-- deletes them every 5 minutes so the delta is small, but we filter to
-- keep numbers accurate between cleanup runs.
--
-- LANGUAGE sql STABLE (not plpgsql):
--   - All aggregates are pure SQL; no control flow needed.
--   - STABLE: the function's result depends on table data but doesn't
--     modify it, and the same call within a transaction returns the same
--     result. Lets the planner inline if useful and lets PostgREST cache
--     the response signature.
--
-- SECURITY DEFINER + SET search_path = '': standard hardening for any
-- function that touches user-data tables. The planner can still inline
-- because STABLE + SECURITY DEFINER + parallel-unsafe (default) compose
-- correctly here.
--
-- Permissions: anyone can call this; the function only reads public-
-- visibility pastes (which are already exposed via /api/recent). REVOKE
-- from PUBLIC and grant explicitly so the surface is auditable.

CREATE OR REPLACE FUNCTION public.paste_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'totalPublic', (
      SELECT count(*)::int
      FROM public.pastes
      WHERE visibility = 'public'
        AND expires_at > now()
    ),
    'byLanguage', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('language', language, 'count', c)
        ORDER BY c DESC
      )
      FROM (
        SELECT coalesce(language, 'unknown') AS language, count(*)::int AS c
        FROM public.pastes
        WHERE visibility = 'public'
          AND expires_at > now()
        GROUP BY language
        ORDER BY c DESC
        LIMIT 20
      ) t
    ), '[]'::jsonb),
    'byHour', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('hour', hour, 'count', c)
        ORDER BY hour DESC
      )
      FROM (
        SELECT date_trunc('hour', created_at) AS hour, count(*)::int AS c
        FROM public.pastes
        WHERE visibility = 'public'
          AND expires_at > now()
          AND created_at > now() - interval '48 hours'
        GROUP BY hour
      ) t
    ), '[]'::jsonb),
    'encryption', coalesce((
      SELECT jsonb_object_agg(version::text, c)
      FROM (
        SELECT version, count(*)::int AS c
        FROM public.pastes
        WHERE visibility = 'public'
          AND expires_at > now()
        GROUP BY version
      ) t
    ), '{}'::jsonb),
    'generatedAt', to_jsonb(now())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.paste_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paste_stats() TO service_role, anon, authenticated;
