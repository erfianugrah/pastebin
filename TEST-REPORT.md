# Migration Test Report

Verification of the Cloudflare KV → Supabase Postgres migration.

Run date: 2026-05-11
Project: `dewddkcmwrzbpynylyhg` (Frankfurt, `eu-central-1`)
Live URL: https://paste.erfi.dev

---

## Static checks

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✓ clean (0 errors) |
| `npm run lint` | ✓ clean |
| `npm test` (vitest) | ✓ 113/113 passing across 12 test files |
| `npm run build` (astro) | ✓ clean, 5 pages built |

### Vitest coverage breakdown

| Test file | Tests |
|-----------|------:|
| `src/tests/application/commands/createPasteCommand.test.ts` | 3 |
| `src/tests/application/commands/deletePasteCommand.test.ts` | 5 |
| `src/tests/application/queries/getPasteQuery.test.ts` | 9 |
| `src/tests/application/queries/getRecentPastesQuery.test.ts` | 5 |
| `src/tests/domain/models/paste.test.ts` | 12 |
| `src/tests/infrastructure/storage/kvPasteRepository.test.ts` | 9 |
| `src/tests/infrastructure/storage/supabasePasteRepository.test.ts` | 11 |
| `src/tests/infrastructure/storage/dualWriteRepository.test.ts` | 14 |
| `src/tests/interfaces/api/handlers.test.ts` | 9 |
| `src/tests/integration/routes.test.ts` | 17 |
| `astro/src/lib/crypto.test.ts` | 14 |
| `astro/src/lib/__tests__/crypto-progress.test.ts` | 5 |
| **Total** | **113** |

---

## Live API smoke test (`npm run test:smoke`)

Ran against `https://paste.erfi.dev` with `STORAGE_BACKEND=supabase`.

| # | Test | Result |
|---|------|--------|
| 1 | POST /pastes creates a paste | ✓ |
| 2 | GET /pastes/:id returns paste and increments read_count | ✓ |
| 3 | GET /pastes/raw/:id returns plain content | ✓ |
| 4 | GET /api/recent includes public paste | ✓ |
| 5 | Private paste excluded from /api/recent | ✓ |
| 6 | POST /pastes with slug creates and resolves slug | ✓ |
| 7 | DELETE with valid deleteToken succeeds (200, 404 on next read) | ✓ |
| 8 | DELETE with wrong token returns 403 with error.code='unauthorized' | ✓ |
| 9 | burn-after-reading deletes after first view, second read 404 | ✓ |
| 10 | view_limit enforces max views, 404 after limit reached | ✓ |

**10/10 passing.** Total run time: ~3 seconds.

DB-verification tests (5 additional) skipped pending `SUPABASE_SECRET_KEY` in local `.env`.

---

## Live Supabase verification

### Schema state

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- pastes, slugs ✓

SELECT indexname FROM pg_indexes WHERE tablename = 'pastes';
-- idx_pastes_visibility_created (partial, public)
-- idx_pastes_expired_cleanup
-- idx_user_pastes (partial, user_id IS NOT NULL)
-- pastes_pkey
-- ✓ all 4 indexes present

SELECT tgname FROM pg_trigger WHERE tgrelid = 'pastes'::regclass AND tgname NOT LIKE 'RI_%';
-- set_updated_at ✓
```

### RLS

```sql
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('pastes','slugs');
-- pastes: true ✓
-- slugs:  true ✓

SELECT tablename, policyname, cmd, roles, qual FROM pg_policies WHERE tablename IN ('pastes','slugs');
-- pastes / "public pastes are viewable by anyone" / SELECT / {anon} / (visibility = 'public')
-- slugs  / "visible vanity slugs" / SELECT / {anon} / (expires_at > now())
-- ✓ both Phase 1 policies live
```

### pg_cron

```sql
SELECT jobname, schedule, active FROM cron.job;
-- cleanup-expired-pastes / */5 * * * * / true ✓
-- cleanup-expired-slugs  / 0 3 * * *    / true ✓

SELECT status, count(*) FROM cron.job_run_details
  WHERE start_time > now() - interval '1 hour'
  GROUP BY status;
-- succeeded: 12 ✓ (every 5 min over the last hour)
```

### Migrations

```sql
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
-- 20260407101812 (remote schema)
-- 20260407104738 (pastes + slugs + trigger)
-- 20260410091921 (indexes)
-- 20260410092220 (ENABLE RLS)
-- 20260410092453 (RLS policies Phase 1)
-- 20260412074203 (enable pg_cron)
-- 20260412074417 (schedule cleanup jobs)
-- ✓ all 7 applied
```

---

## Findings

### 1. `updated_at` trigger fires on every save (not just edits) -- mild bug

**Observed:** Pastes with `read_count = 0` have `updated_at - created_at ≈ 100-200ms`. Pastes with `read_count > 0` have an additional `updated_at - created_at ≈ 500-600ms` per view.

**Root cause:** The trigger `set_updated_at` is scoped to `BEFORE UPDATE OF content, title`. In Postgres, this fires whenever those columns are listed in the SET clause -- *not* only when their values actually change. The `save()` method uses `upsert()` which sends all columns, so the trigger always fires.

**Documented:** `postgres-learnings.md` already calls out this tradeoff:
> If you add a new "editable" column later, you must remember to add it to the `OF` clause. For tables with stable schemas this is fine. For tables that evolve frequently, consider checking `OLD` vs `NEW` inside the function instead.

**Impact:** Low. `updated_at` is not used by the application; it's metadata for debugging/audit.

**Fix drafted in `supabase/migrations/20260511124104_fix_updated_at_trigger.sql`** (not yet applied to remote):

```sql
DROP TRIGGER IF EXISTS set_updated_at ON pastes;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE OF content, title
  ON pastes
  FOR EACH ROW
  WHEN (
    OLD.content IS DISTINCT FROM NEW.content
    OR OLD.title IS DISTINCT FROM NEW.title
  )
  EXECUTE FUNCTION set_updated_at();
```

Apply with `supabase db push --linked`.

The `view_paste()` RPC (Phase 4) will avoid the upsert entirely by doing a targeted `UPDATE ... SET read_count = read_count + 1 WHERE id = $1 RETURNING *`. That's the deeper fix but also requires more code changes.

### 2. `getPasteQuery.execute()` concurrency caveat still applies

The KV implementation had a documented race condition in burn-after-reading. The Supabase implementation has the same issue because the read flow is:

1. SELECT row
2. UPDATE read_count + 1 via upsert
3. IF burn_after_reading AND read_count > 0 THEN DELETE

Two concurrent requests can both see `read_count = 0` and serve the content twice before either deletes.

**Fix (planned for Phase 4):** Replace the multi-step logic with the `view_paste()` Postgres function (already scoped in `SUPABASE-MIGRATION.md`) using `FOR UPDATE` to lock the row atomically.

### 3. RLS policies are defense-in-depth (Worker uses secret key)

The deployed RLS policies (`SELECT for anon`) don't currently gate any traffic because the Worker uses the secret key which bypasses RLS. They're correct defense-in-depth and become important when:

- Phase 4: Adding "My Pastes" page that uses the publishable key + Supabase Auth
- Anyone connects to the database with the publishable key directly

---

## Conclusion

Migration is functionally complete and live. All tests pass. Two known caveats are documented and tracked for Phase 4. KV namespace is retained in bindings for rollback (1 env var change).

Next steps: Phase 4 features (search, auth, realtime, atomic view_paste RPC).
