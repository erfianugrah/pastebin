# Pasteriser — Supabase Studio SQL Queries

All queries verified against live DB (`dewddkcmwrzbpynylyhg`). Studio runs as
`service_role` so RLS is bypassed — these see everything.

Jump to: [Monitoring](#monitoring) · [Performance](#performance) · [Maintenance](#maintenance) · [Extensions](#extensions)

---

## Monitoring

### 1. Health snapshot

One-row overview of the entire dataset.

```sql
select
  count(*)                                                               as total,
  count(*) filter (where expires_at > now())                            as active,
  count(*) filter (where expires_at <= now())                           as expired_pending_cleanup,
  count(*) filter (where visibility = 'public'  and expires_at > now()) as public_active,
  count(*) filter (where visibility = 'private' and expires_at > now()) as private_active,
  count(*) filter (where is_encrypted           and expires_at > now()) as encrypted_active,
  count(*) filter (where burn_after_reading     and expires_at > now()) as burn_active,
  count(*) filter (where view_limit is not null and expires_at > now()) as view_limited_active,
  count(*) filter (where user_id is not null    and expires_at > now()) as owned_active,
  count(*) filter (where user_id is null        and expires_at > now()) as anonymous_active
from public.pastes;
```

---

### 2. Encryption version breakdown

How many pastes use each encryption scheme — total and still-active.

```sql
select
  version,
  case version
    when 0 then 'plaintext'
    when 2 then 'legacy E2EE (content only)'
    when 3 then 'E2EE content + title'
    when 4 then 'Argon2id + padding (current)'
  end                                                as label,
  count(*)                                           as total,
  count(*) filter (where expires_at > now())         as active
from public.pastes
group by version
order by version;
```

---

### 3. Top languages (active public pastes)

Most popular language tags with percentage share.

```sql
select
  coalesce(language, '(none)')                                          as language,
  count(*)                                                              as pastes,
  round(100.0 * count(*) / sum(count(*)) over (), 1)                   as pct
from public.pastes
where visibility = 'public' and expires_at > now()
group by language
order by pastes desc
limit 25;
```

---

### 4. Daily creation trend — last 30 days

```sql
select
  date_trunc('day', created_at)                              as day,
  count(*)                                                   as total,
  count(*) filter (where visibility = 'public')              as public,
  count(*) filter (where visibility = 'private')             as private,
  count(*) filter (where is_encrypted)                       as encrypted
from public.pastes
where created_at >= now() - interval '30 days'
group by 1
order by 1;
```

---

### 5. Top pastes by view count

Most-read active pastes. Excludes encrypted (their title is ciphertext).

```sql
select
  id,
  coalesce(title, '(untitled)')  as title,
  coalesce(language, '—')        as language,
  read_count,
  view_limit,
  burn_after_reading,
  created_at,
  expires_at
from public.pastes
where expires_at > now()
  and not is_encrypted
order by read_count desc
limit 20;
```

---

### 6. Users by paste count

Registered users ranked by pastes created.

```sql
select
  u.email,
  p.user_id,
  count(*)                                                as total,
  count(*) filter (where p.expires_at > now())            as active,
  count(*) filter (where p.visibility = 'public')         as public,
  count(*) filter (where p.is_encrypted)                  as encrypted,
  max(p.created_at)                                       as last_created
from public.pastes p
join auth.users u on u.id = p.user_id
group by p.user_id, u.email
order by total desc
limit 20;
```

---

### 7. Expiring in the next 24 hours

```sql
select
  id,
  coalesce(title, '(untitled)')  as title,
  visibility,
  is_encrypted,
  read_count,
  expires_at
from public.pastes
where expires_at between now() and now() + interval '24 hours'
order by expires_at;
```

---

### 8. Slug table health

Total / active / expired-pending-cleanup / orphaned (should always be 0 — ON DELETE CASCADE).

```sql
select
  count(*)                                       as total,
  count(*) filter (where expires_at > now())     as active,
  count(*) filter (where expires_at <= now())    as expired_pending_cleanup,
  count(*) filter (where paste_id is null)       as orphaned
from public.slugs;
```

---

### 9. Largest pastes (active)

Biggest pastes by raw content byte size. Spot abuse or unexpected uploads.

```sql
select
  id,
  coalesce(title, '(untitled)')            as title,
  coalesce(language, '—')                  as language,
  is_encrypted,
  pg_size_pretty(length(content)::bigint)  as size,
  length(content)                          as bytes,
  read_count,
  created_at
from public.pastes
where expires_at > now()
order by length(content) desc
limit 20;
```

---

### 10. Auth users

All registered users with sign-in providers and confirmation status.

```sql
select
  u.id,
  u.email,
  u.email_confirmed_at is not null           as confirmed,
  u.last_sign_in_at,
  u.created_at,
  array_agg(i.provider order by i.provider)  as providers
from auth.users u
left join auth.identities i on i.user_id = u.id
group by u.id, u.email, u.email_confirmed_at, u.last_sign_in_at, u.created_at
order by u.created_at desc
limit 50;
```

---

### 11. Table sizes + dead rows

Storage breakdown and vacuum health. High `dead_rows` relative to `live_rows` means
autovacuum hasn't fired recently — normal in small bursts, watch if ratio > 20%.

```sql
select
  s.relname                                                      as table,
  pg_size_pretty(pg_total_relation_size(s.relid))               as total_size,
  pg_size_pretty(pg_relation_size(s.relid))                     as table_size,
  pg_size_pretty(pg_indexes_size(s.relid))                      as indexes_size,
  s.n_live_tup                                                  as live_rows,
  s.n_dead_tup                                                  as dead_rows,
  s.last_autovacuum,
  s.last_autoanalyze
from pg_stat_user_tables s
where s.schemaname = 'public'
order by pg_total_relation_size(s.relid) desc;
```

---

### 12. paste_stats() RPC

Calls the same aggregate function used by `GET /api/stats`. Returns a JSONB blob with
`totalPublic`, `byLanguage`, `byHour` (last 48 h), `encryption` version map, and `generatedAt`.

```sql
select public.paste_stats();
```

---

### 13. Paste lookup by ID (debug / support)

Replace `'<paste-uuid>'` with the actual UUID. Returns the full row including
`delete_token` and `user_id` — do not share output externally.

```sql
select
  id,
  user_id,
  title,
  language,
  visibility,
  is_encrypted,
  version,
  burn_after_reading,
  read_count,
  view_limit,
  delete_token,
  created_at,
  updated_at,
  expires_at,
  length(content) as content_bytes
from public.pastes
where id = '<paste-uuid>';
```

---

## Performance

### 14. pg_cron — job status

Active jobs and their schedules.

```sql
select jobname, schedule, command, nodename, active
from cron.job
order by jobname;
```

---

### 15. pg_cron — recent run history (last 50)

`DELETE 0` in `return_message` is normal when no pastes have expired.

```sql
select
  j.jobname,
  r.start_time,
  r.end_time,
  r.status,
  r.return_message
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
order by r.start_time desc
limit 50;
```

---

### 16. pg_stat_statements — app queries by total time

Filters to queries actually touching app tables or RPCs. The `pgrst_source` CTE wrapper
is PostgREST — every Worker call goes through it.

*Verified baseline (empty DB):*
- `view_paste` RPC — 2 550 calls, **mean 1.28 ms**, max 62 ms
- `delete_paste` RPC — 27 calls, mean 0.69 ms
- `paste_stats()` RPC — 5 calls, mean 4.50 ms
- Paste INSERT — 239 calls, mean 6.30 ms
- Slug cron DELETE — 2 884 calls, mean 0.14 ms
- Paste cron DELETE — 8 650 calls, mean 0.04 ms

```sql
select
  round(total_exec_time::numeric, 2)                                      as total_ms,
  calls,
  round(mean_exec_time::numeric, 2)                                       as mean_ms,
  round(max_exec_time::numeric, 2)                                        as max_ms,
  round(stddev_exec_time::numeric, 2)                                     as stddev_ms,
  rows,
  round((100 * total_exec_time / sum(total_exec_time) over ())::numeric, 1) as pct,
  left(query, 200)                                                        as query
from extensions.pg_stat_statements
where query ilike '%public.pastes%'
   or query ilike '%public.slugs%'
   or query ilike '%view_paste%'
   or query ilike '%delete_paste%'
   or query ilike '%update_paste%'
   or query ilike '%paste_stats%'
   or query ilike '%cron.job_run%'
order by total_exec_time desc
limit 20;
```

---

### 17. pg_stat_statements — highest individual latency

Finds one-off slow calls — max_exec_time outliers. Useful after a deploy or incident to
check if any single call took an unusually long time (lock wait, cold cache, etc.).

```sql
select
  round(max_exec_time::numeric, 2)                        as max_ms,
  round(mean_exec_time::numeric, 2)                       as mean_ms,
  round(stddev_exec_time::numeric, 2)                     as stddev_ms,
  calls,
  left(query, 200)                                        as query
from extensions.pg_stat_statements
where calls > 5
  and (query ilike '%public.pastes%'
    or query ilike '%view_paste%'
    or query ilike '%delete_paste%'
    or query ilike '%update_paste%')
order by max_exec_time desc
limit 15;
```

---

### 18. pg_stat_statements — high variance queries (lock contention signal)

`stddev > 3 × mean` on a well-called query usually means intermittent lock waits.
The `view_paste`, `delete_paste`, and `update_paste` RPCs all use `SELECT … FOR UPDATE`
so they serialise under concurrent load — watch this as traffic grows.

```sql
select
  calls,
  round(mean_exec_time::numeric, 2)                       as mean_ms,
  round(stddev_exec_time::numeric, 2)                     as stddev_ms,
  round((stddev_exec_time / nullif(mean_exec_time, 0))::numeric, 1)  as cv,
  round(max_exec_time::numeric, 2)                        as max_ms,
  left(query, 200)                                        as query
from extensions.pg_stat_statements
where calls > 10
  and stddev_exec_time > 3 * mean_exec_time
  and (query ilike '%public.pastes%'
    or query ilike '%view_paste%'
    or query ilike '%delete_paste%'
    or query ilike '%update_paste%')
order by cv desc
limit 15;
```

---

### 19. Cache hit ratio

`heap_hit_pct` and `idx_hit_pct` should both be > 99% on Supabase's shared_buffers.
Drop below 95% → working set has outgrown RAM.

*Verified baseline: 100% heap, 99.98% index.*

```sql
select
  relname                                                                        as table,
  heap_blks_read                                                                 as heap_reads,
  heap_blks_hit                                                                  as heap_hits,
  round(100.0 * heap_blks_hit / nullif(heap_blks_hit + heap_blks_read, 0), 2)  as heap_hit_pct,
  idx_blks_read                                                                  as idx_reads,
  idx_blks_hit                                                                   as idx_hits,
  round(100.0 * idx_blks_hit  / nullif(idx_blks_hit  + idx_blks_read,  0), 2)  as idx_hit_pct
from pg_statio_user_tables
where schemaname = 'public'
order by heap_blks_hit + heap_blks_read desc;
```

---

### 20. Sequential scan detector

`seq_scan` higher than `idx_scan` on a large table is the main index-health signal.
`avg_rows_per_seqscan` > 1 000 on a table with millions of rows = missing index.

Note: at low row counts (< ~1 000) Postgres often prefers seq scans even when indexes
exist — only act on this if `n_live_tup` is meaningfully large.

```sql
select
  relname                                                              as table,
  seq_scan,
  seq_tup_read,
  idx_scan,
  idx_tup_fetch,
  n_live_tup                                                           as live_rows,
  case when seq_scan > 0
    then round(seq_tup_read::numeric / seq_scan, 0)
  end                                                                  as avg_rows_per_seqscan
from pg_stat_user_tables
where schemaname = 'public'
order by seq_scan desc;
```

---

### 21. Index usage

Scan counts and sizes per index. Key things to watch:

| Index | Purpose | Expected |
|---|---|---|
| `idx_pastes_expired_cleanup` | Cron DELETE every 5 min | Highest scan count |
| `pastes_pkey` | Direct ID lookups | Second highest |
| `idx_pastes_visibility_created` | Recent public feed | Grows with traffic |
| `idx_pastes_search` | FTS via `search_vector` | 0 until search is used |
| `idx_user_pastes` | User's own pastes | Grows with auth traffic |

```sql
select
  indexrelname                                              as index,
  relname                                                   as table,
  idx_scan                                                  as scans,
  idx_tup_read                                              as tuples_read,
  idx_tup_fetch                                             as tuples_fetched,
  pg_size_pretty(pg_relation_size(indexrelid))              as size
from pg_stat_user_indexes
where schemaname = 'public'
order by idx_scan desc;
```

---

### 22. Unused indexes

Non-PK indexes with zero scans. Worth reviewing — they add write overhead on every
INSERT/UPDATE/DELETE with no read benefit. `idx_pastes_search` will appear here until
search is used; that's intentional. Drop anything else that's been idle for weeks.

```sql
select
  indexrelname                                           as index,
  relname                                                as table,
  idx_scan                                               as scans,
  pg_size_pretty(pg_relation_size(indexrelid))           as size
from pg_stat_user_indexes
where schemaname = 'public'
  and idx_scan = 0
  and indexrelname not like '%_pkey'
order by pg_relation_size(indexrelid) desc;
```

---

### 23. TOAST table size (pastes.content)

`content` is `text` — rows > 2 KB are stored out-of-line in the TOAST table.
This grows as large pastes are created and only shrinks after vacuum runs.

```sql
select
  c.relname                                               as table,
  t.relname                                               as toast_table,
  pg_size_pretty(pg_relation_size(c.reltoastrelid))       as toast_size,
  pg_size_pretty(pg_total_relation_size(c.oid))           as total_size
from pg_class c
join pg_class t on t.oid = c.reltoastrelid
where c.relname = 'pastes';
```

---

### 24. Active connections + query age

Shows what's running right now. Anything with `state = 'active'` and `query_age_s > 5`
warrants investigation — could be a stuck `FOR UPDATE` lock or a slow stats query.

```sql
select
  pid,
  usename,
  application_name,
  client_addr,
  state,
  wait_event_type,
  wait_event,
  round(extract(epoch from (now() - query_start))::numeric, 1)  as query_age_s,
  left(query, 120)                                               as query
from pg_stat_activity
where state != 'idle'
  and pid != pg_backend_pid()
order by query_start;
```

---

### 25. Lock waits (incident response)

Returns rows only when something is actually blocked. Run this when a request hangs.
The `view_paste` / `delete_paste` / `update_paste` RPCs all use `SELECT … FOR UPDATE`
and will show up here under burst load.

```sql
select
  blocked.pid                         as blocked_pid,
  blocked.usename                     as blocked_user,
  blocking.pid                        as blocking_pid,
  blocking.usename                    as blocking_user,
  blocked.state                       as blocked_state,
  left(blocked.query,  100)           as blocked_query,
  left(blocking.query, 100)           as blocking_query
from pg_stat_activity blocked
join pg_stat_activity blocking
  on blocking.pid = any(pg_blocking_pids(blocked.pid))
where cardinality(pg_blocking_pids(blocked.pid)) > 0;
```

---

### 26. Connection pool state

Overall count by connection state. 4–8 idle connections is normal for Supabase's
Transaction-mode pgBouncer at low traffic. Spike in `active` connections = hot path.

```sql
select
  state,
  count(*)                                              as connections,
  max(extract(epoch from (now() - query_start)))::int   as max_query_age_s
from pg_stat_activity
where datname = current_database()
group by state
order by connections desc;
```

---

### 27. Autovacuum settings

Global autovacuum thresholds. The default `scale_factor = 0.2` means vacuum fires when
20% of rows are dead — at 100 k rows that's 20 k dead tuples accumulating.

`pastes` churns `read_count` on every view (`UPDATE` creates dead tuples even though
the value changes). Consider tightening the table-level override (see Maintenance §29).

```sql
select name, setting, unit
from pg_settings
where name in (
  'autovacuum_vacuum_scale_factor',
  'autovacuum_analyze_scale_factor',
  'autovacuum_vacuum_threshold',
  'autovacuum_vacuum_cost_delay',
  'autovacuum_vacuum_cost_limit',
  'autovacuum_naptime'
)
order by name;
```

---

### 28. EXPLAIN — critical query paths

Run these to inspect the query plan for the three most important read paths. Paste the
output into https://explain.depesz.com for a visual breakdown.

**Recent public pastes** (used by `GET /api/recent`):
```sql
explain (analyze, buffers, format text)
select id, title, language, created_at, expires_at, is_encrypted, burn_after_reading, version
from public.pastes
where visibility = 'public' and expires_at > now()
order by created_at desc
limit 20;
```

**Full-text search** (used by `GET /api/search`):
```sql
explain (analyze, buffers, format text)
select id, title, language, created_at, expires_at, is_encrypted
from public.pastes
where visibility = 'public'
  and expires_at > now()
  and search_vector @@ websearch_to_tsquery('english', 'typescript react')
order by created_at desc
limit 20;
```

> On a small/empty table the planner will use `idx_pastes_visibility_created` with
> `search_vector @@` as a post-filter rather than the GIN index. That's correct
> planner behaviour — the GIN index becomes the preferred path once the table is
> large enough for the selectivity to pay off. At scale you should see
> `Bitmap Index Scan on idx_pastes_search`.

**Cron batch delete** (verify index is used, not seq scan):
```sql
explain (analyze, buffers, format text)
delete from public.pastes
where id in (
  select id from public.pastes
  where expires_at < now()
  limit 1000
);
```

> On an empty table this shows a Seq Scan — correct, index scans have overhead that
> outweighs benefits at near-zero row counts. At scale you should see
> `Index Scan using idx_pastes_expired_cleanup`.

---

## Maintenance

### 29. Tighten autovacuum for `pastes`

**Already applied to production** (verified via `reloptions`).

`pastes.read_count` is incremented on every view — that's one dead tuple per view, per
paste. At scale (e.g. 50 k pastes × 10 views each = 500 k dead tuples before the
default 20% scale factor fires on a 100 k-row table). Table-level override:

```sql
-- Fire vacuum when 5% of rows are dead (instead of 20%), minimum 100 rows.
-- Also tighten analyze so the planner stays current as pastes are created/deleted.
alter table public.pastes set (
  autovacuum_vacuum_scale_factor   = 0.05,
  autovacuum_analyze_scale_factor  = 0.05,
  autovacuum_vacuum_threshold      = 100,
  autovacuum_analyze_threshold     = 100
);
```

Verify it took effect:

```sql
select relname, reloptions
from pg_class
where relname = 'pastes';
```

---

### 30. Manual VACUUM ANALYZE (after bulk operation)

Run after a large import, bulk delete, or migration that changes many rows. Supabase
autovacuum will handle normal traffic but won't fire mid-migration.

```sql
vacuum analyze public.pastes;
vacuum analyze public.slugs;
```

---

### 31. Reset pg_stat_statements (after deploy / baseline reset)

Clears accumulated query stats. Run immediately after deploying a performance fix so
you get a clean before/after comparison. Does not affect the database — only the stats
counters.

```sql
select extensions.pg_stat_statements_reset();
```

---

## Extensions

Queries against `pg_available_extensions`, `pg_extension`, and `pg_depend` to audit
what's installed on the Supabase Postgres instance, what's active, where each lives,
how many objects each extension owns, and which extensions depend on others.

---

### 32. Available extensions (all — installed and not yet enabled)

Shows every extension Supabase has compiled into the server, whether it is currently
enabled, and its current vs default version. `installed_version IS NOT NULL` means
it has been `CREATE EXTENSION`-d in this database.

```sql
select
  name,
  default_version,
  installed_version,
  installed_version is not null as is_enabled,
  comment
from pg_available_extensions
order by is_enabled desc, name;
```

---

### 33. Enabled extensions — schema mapping

Joins `pg_extension` (runtime catalogue) with `pg_namespace` to show which schema each
enabled extension was installed into. Supabase installs most extensions into the
`extensions` schema to keep `public` clean; some (e.g. `pg_cron`) go into `pg_catalog`.

```sql
select
  e.extname                          as extension,
  e.extversion                       as version,
  n.nspname                          as schema,
  e.extrelocatable                   as relocatable,
  obj_description(e.oid, 'pg_extension') as description
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
order by e.extname;
```

---

### 34. Object counts owned by each extension

Uses `pg_depend` to count how many database objects (tables, functions, types, operators,
etc.) each extension owns. High numbers indicate extensions that modify the catalogue
heavily — relevant when planning upgrades or drops.

```sql
select
  e.extname                 as extension,
  d.classid::regclass       as object_class,
  count(*)                  as owned_objects
from pg_depend d
join pg_extension e on e.oid = d.refobjid
where d.deptype = 'e'
group by e.extname, d.classid
order by e.extname, owned_objects desc;
```

For a single total-per-extension rollup:

```sql
select
  e.extname   as extension,
  count(*)    as total_owned_objects
from pg_depend d
join pg_extension e on e.oid = d.refobjid
where d.deptype = 'e'
group by e.extname
order by total_owned_objects desc;
```

---

### 35. Extension dependency chain

Shows which enabled extensions depend on other enabled extensions (`pg_depend` rows
where both `objid` and `refobjid` are `pg_extension` OIDs). Relevant before dropping
an extension — if anything depends on it, the drop will fail.

```sql
select
  e_dep.extname  as extension,
  e_req.extname  as requires
from pg_depend d
join pg_extension e_dep on e_dep.oid = d.objid
join pg_extension e_req on e_req.oid = d.refobjid
where d.deptype = 'n'  -- 'n' = normal dependency between catalogue objects
order by e_dep.extname;
```

If the result is empty there are no cross-extension dependencies currently active.

---

## Notes

- All timestamps are UTC.
- `expires_at <= now()` rows are cleaned by `cleanup-expired-pastes` (every 5 min,
  batch of 1 000). A small backlog of expired rows is always expected.
- Encrypted pastes (`is_encrypted = true`) have `search_vector = ''` — excluded from
  FTS. Their `title` and `language` are E2EE ciphertext and `null` server-side for v4.
- `version` values: `0` plaintext · `2` legacy E2EE content-only · `3` E2EE content+title ·
  `4` Argon2id+padding (default for new encrypted pastes).
- The Worker accesses Postgres exclusively through PostgREST (supabase-js). All app
  queries appear in `pg_stat_statements` wrapped in a `WITH pgrst_source AS (...)` CTE.
  Direct SQL from Studio and the `pgpasteriser` alias (pgcli) appear without the wrapper.
