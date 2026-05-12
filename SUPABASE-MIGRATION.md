# Pasteriser: Supabase Migration Scope

## Current Architecture

```
Browser (Astro + React)
  -> Cloudflare Worker (Hono router)
    -> KV Namespace: PASTES (paste data + recent list + vanity slugs)
```

Single KV namespace. No auth. No database. No analytics persistence.

Live at: https://paste.erfi.io

### Current Data Model

**Paste entity** (from `src/domain/models/paste.ts`):

| Field              | Type                      | Notes                                                                                  |
| ------------------ | ------------------------- | -------------------------------------------------------------------------------------- |
| `id`               | string (PasteId)          | Generated via custom UUIDv7 (time-ordered, RFC 9562) in `cloudflareUniqueIdService.ts` |
| `content`          | string                    | Max 25 MiB. May be E2E encrypted ciphertext.                                           |
| `title`            | string?                   | Max 100 chars                                                                          |
| `language`         | string?                   | Syntax highlighting language                                                           |
| `createdAt`        | ISO date string           | Set at creation                                                                        |
| `expiresAt`        | ISO date string           | Computed from `createdAt` + expiration seconds                                         |
| `visibility`       | `'public'` or `'private'` | Controls listing                                                                       |
| `burnAfterReading` | boolean                   | Delete after first view                                                                |
| `readCount`        | number                    | Incremented on each view                                                               |
| `isEncrypted`      | boolean                   | Whether content is E2E encrypted                                                       |
| `viewLimit`        | number?                   | 1-100, auto-delete when reached                                                        |
| `version`          | number                    | 0=plaintext, 2=client-side E2E                                                         |
| `deleteToken`      | string?                   | UUID, returned only at creation. Required for delete/update.                           |

**KV key patterns:**

- `{pasteId}` -> JSON paste data (with TTL = expiration)
- `recent:{timestamp}:{pasteId}` -> paste ID (with TTL, for recent public listing)
- `slug:{slug}` -> paste ID (with TTL, for vanity URLs)

### Current API Surface

| Method        | Path                 | Auth        | Description               |
| ------------- | -------------------- | ----------- | ------------------------- |
| `POST`        | `/pastes`            | None        | Create paste              |
| `GET`         | `/pastes/:id`        | None        | View paste (JSON or HTML) |
| `GET`         | `/pastes/raw/:id`    | None        | Raw content as text/plain |
| `PUT`         | `/pastes/:id`        | deleteToken | Update paste content      |
| `DELETE/POST` | `/pastes/:id/delete` | deleteToken | Delete paste              |
| `GET`         | `/api/recent`        | None        | List recent public pastes |
| `GET`         | `/p/:slug`           | None        | Vanity URL redirect       |

### Current DDD Layers

```
domain/
  models/paste.ts          -- Paste, PasteId, ExpirationPolicy (value objects)
  repositories/pasteRepository.ts  -- PasteRepository interface (6 methods)
  services/expirationService.ts    -- ExpirationService interface
  services/uniqueIdService.ts      -- UniqueIdService interface

application/
  commands/createPasteCommand.ts   -- Create with Zod validation
  commands/deletePasteCommand.ts   -- Delete with token auth
  queries/getPasteQuery.ts         -- Get with view counting, burn, expiry
  queries/getRecentPastesQuery.ts  -- Recent public listing
  factories/pasteFactory.ts        -- Rehydrate Paste from storage data

infrastructure/
  storage/kvPasteRepository.ts     -- KV implementation of PasteRepository
  caching/cacheControl.ts          -- HTTP cache headers
  config/config.ts                 -- App config
  logging/logger.ts                -- Structured logging
  services/cloudflareUniqueIdService.ts  -- UUIDv7 generation (time-ordered)

interfaces/
  api/handlers.ts          -- Hono route handlers
  api/middleware.ts         -- Security headers
```

### Repository Interface (the seam)

```typescript
interface PasteRepository {
	save(paste: Paste): Promise<void>;
	findById(id: PasteId): Promise<Paste | null>;
	delete(id: PasteId): Promise<boolean>;
	findRecentPublic(limit: number): Promise<Paste[]>;
	resolveSlug(slug: string): Promise<string | null>;
	saveSlug(slug: string, pasteId: string, expiresAt: Date): Promise<void>;
}
```

This is the migration seam. A `SupabasePasteRepository` implementing this interface slots in without changing domain, application, or interface layers.

---

## What KV Can't Do (Why Migrate)

1. **No search** -- can't find pastes by title, language, content, or date range
2. **No filtering** -- recent list requires paginating ALL `recent:*` keys, sorting client-side
3. **No analytics** -- removed from the app (previously in separate KV namespaces, now gone per wrangler.jsonc showing only PASTES binding)
4. **No user accounts** -- pastes are anonymous, no way to see "my pastes"
5. **No aggregation** -- can't count pastes by language, encryption type, or visibility
6. **Eventual consistency** -- burn-after-reading and view limits can be violated by concurrent requests (documented in getPasteQuery.ts comments)

---

## Deployed Supabase Schema

Phase 0 is complete. The following is the actual deployed schema (verified against live Supabase project `dewddkcmwrzbpynylyhg`).

### Tables (migration: `20260407104738_creates_pastes_schema.sql`)

```sql
-- Note: IDs are UUIDv7 (time-ordered) generated by the Worker.
-- gen_random_uuid() default is a fallback only.
CREATE TABLE pastes (
    id               UUID        PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    user_id          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    content          TEXT        NOT NULL,
    title            TEXT        NOT NULL,
    language         TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),          -- nullable: Postgres always sets this via DEFAULT
    expires_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    visibility       TEXT        CHECK (visibility IN ('public', 'private')) NOT NULL,
    burn_after_reading BOOLEAN   NOT NULL DEFAULT false,
    read_count       INT         NOT NULL DEFAULT 0,
    is_encrypted     BOOLEAN     NOT NULL DEFAULT false,
    view_limit       INT,
    version          INT         NOT NULL DEFAULT 0,
    delete_token     UUID        NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE slugs (
    slug             TEXT        PRIMARY KEY NOT NULL,
    paste_id         UUID        REFERENCES pastes(id) ON DELETE CASCADE,
    expires_at       TIMESTAMPTZ NOT NULL
);

-- Auto-update updated_at on content/title changes only.
-- WHEN clause added in 20260511124104_fix_updated_at_trigger.sql --
-- without it, upsert() resending unchanged content/title would still fire
-- the trigger (UPDATE OF fires on column presence, not value change).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE OF content, title
  ON pastes FOR EACH ROW
  WHEN (
    OLD.content IS DISTINCT FROM NEW.content
    OR OLD.title IS DISTINCT FROM NEW.title
  )
  EXECUTE FUNCTION set_updated_at();
```

### Indexes (migration: `20260410091921_add_pastes_indexes.sql`)

```sql
CREATE INDEX idx_pastes_visibility_created ON pastes (visibility, created_at DESC)
  WHERE visibility = 'public';

CREATE INDEX idx_pastes_expired_cleanup ON pastes (expires_at);

CREATE INDEX idx_user_pastes ON pastes (user_id)
  WHERE user_id IS NOT NULL;
```

### RLS (migrations: `add_rls_policies.sql`, `add_rls_policies_phase1.sql`)

**Important:** In Phases 1-3, the Worker uses the `service_role` key, which bypasses RLS entirely. These policies are defense-in-depth -- they matter if the `anon` key is ever used directly.

```sql
-- Enable RLS on both tables
ALTER TABLE pastes ENABLE ROW LEVEL SECURITY;
ALTER TABLE slugs ENABLE ROW LEVEL SECURITY;
```

**Deployed Phase 1 policies** (verified via `pg_policies`):

```sql
-- Public pastes visible to anon
CREATE POLICY "public pastes are viewable by anyone"
  ON pastes FOR SELECT
  TO anon
  USING (visibility = 'public');

-- Non-expired slugs visible to anon
CREATE POLICY "visible vanity slugs"
  ON slugs FOR SELECT
  TO anon
  USING (expires_at > now());
```

**Phase 4 policies** (not yet deployed -- add when user accounts are implemented):

```sql
-- Private pastes: design decision needed.
-- Current app behavior: anyone with direct URL can view any paste.
-- Visibility only controls listing (findRecentPublic).
-- Worker always uses service_role for direct-ID lookups anyway.
--
-- Option A: Keep current behavior (no additional policy needed)
-- Option B: Restrict private pastes to authenticated creators:
-- CREATE POLICY "private pastes viewable by creator"
--   ON pastes FOR SELECT TO authenticated
--   USING (visibility = 'private' AND user_id = (select auth.uid()));

-- Creator can update their own paste
CREATE POLICY "creator can update own pastes"
  ON pastes FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()));

-- Creator can delete their own paste
CREATE POLICY "creator can delete own pastes"
  ON pastes FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));
```

### Expiration Cleanup (migrations: `enable_pg_cron.sql`, `schedule_cleanup_jobs.sql`)

```sql
-- Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Delete expired pastes every 5 minutes
SELECT cron.schedule(
  'cleanup-expired-pastes',
  '*/5 * * * *',
  $$ DELETE FROM pastes WHERE expires_at < now() $$
);

-- Delete expired slugs daily at 3am
SELECT cron.schedule(
  'cleanup-expired-slugs',
  '0 3 * * *',
  $$ DELETE FROM slugs WHERE expires_at < now() $$
);
```

Verified live: `SELECT jobname, schedule FROM cron.job;` returns both jobs.

### Postgres Functions (for atomic operations)

```sql
-- Atomic view count increment + burn-after-reading + view-limit enforcement
-- Solves the KV eventual consistency problem
CREATE OR REPLACE FUNCTION view_paste(paste_uuid uuid)
RETURNS TABLE (
  paste_data jsonb,
  was_burned boolean,
  was_view_limited boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  p pastes%ROWTYPE;
BEGIN
  -- Lock the row to prevent concurrent read-count races
  SELECT * INTO p FROM pastes WHERE id = paste_uuid FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Check expiry
  IF p.expires_at < now() THEN
    DELETE FROM pastes WHERE id = paste_uuid;
    RETURN;
  END IF;

  -- Check view limit already reached
  IF p.view_limit IS NOT NULL AND p.read_count >= p.view_limit THEN
    DELETE FROM pastes WHERE id = paste_uuid;
    RETURN;
  END IF;

  -- Increment read count
  UPDATE pastes SET read_count = read_count + 1 WHERE id = paste_uuid
    RETURNING * INTO p;

  -- Burn after reading
  IF p.burn_after_reading AND p.read_count > 0 THEN
    DELETE FROM pastes WHERE id = paste_uuid;
    paste_data := to_jsonb(p);
    was_burned := true;
    was_view_limited := false;
    RETURN NEXT;
    RETURN;
  END IF;

  -- View limit reached after this view
  IF p.view_limit IS NOT NULL AND p.read_count >= p.view_limit THEN
    DELETE FROM pastes WHERE id = paste_uuid;
    paste_data := to_jsonb(p);
    was_burned := false;
    was_view_limited := true;
    RETURN NEXT;
    RETURN;
  END IF;

  paste_data := to_jsonb(p);
  was_burned := false;
  was_view_limited := false;
  RETURN NEXT;
END;
$$;
```

This function solves the concurrency problem documented in `getPasteQuery.ts` -- KV's eventual consistency means burn-after-reading can be served to multiple viewers. Postgres `FOR UPDATE` row lock prevents this.

---

## New Repository Implementation

```typescript
// src/infrastructure/storage/supabasePasteRepository.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Paste, PasteId, PasteData } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { PasteFactory } from '../../application/factories/pasteFactory';
import { Logger } from '../logging/logger';

export class SupabasePasteRepository implements PasteRepository {
	private readonly client: SupabaseClient;

	constructor(
		supabaseUrl: string,
		supabaseKey: string, // secret key (sb_secret_...) -- Worker is trusted backend, bypasses RLS
		private readonly logger: Logger,
	) {
		// Server-side client: disable session management. Worker uses a secret
		// key (no JWT refresh needed); persistSession would try to use
		// localStorage (unavailable in Workers); autoRefreshToken sets a
		// setTimeout that does nothing useful here.
		this.client = createClient(supabaseUrl, supabaseKey, {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
				detectSessionInUrl: false,
			},
		});
	}

	async save(paste: Paste): Promise<void> {
		const data = paste.toJSON(true); // include deleteToken
		const { error } = await this.client.from('pastes').upsert({
			id: data.id,
			content: data.content,
			title: data.title,
			language: data.language,
			visibility: data.visibility,
			is_encrypted: data.isEncrypted,
			version: data.version,
			burn_after_reading: data.burnAfterReading,
			read_count: data.readCount,
			view_limit: data.viewLimit,
			delete_token: data.deleteToken,
			created_at: data.createdAt,
			expires_at: data.expiresAt,
		});

		if (error) {
			this.logger.error('Supabase save failed', { error });
			throw new Error(`Failed to save paste: ${error.message}`);
		}
	}

	async findById(id: PasteId): Promise<Paste | null> {
		const { data, error } = await this.client.from('pastes').select('*').eq('id', id.toString()).single();

		if (error) {
			// PGRST116 = no rows -- not a real error, don't log it
			if (error.code === 'PGRST116') return null;
			this.logger.error('Supabase: findById failed', { error });
			return null;
		}

		if (!data) return null;

		return PasteFactory.fromData(this.mapRow(data));
	}

	async delete(id: PasteId): Promise<boolean> {
		const { error, count } = await this.client.from('pastes').delete({ count: 'exact' }).eq('id', id.toString());

		if (error) return false;
		return (count ?? 0) > 0;
	}

	async findRecentPublic(limit: number): Promise<Paste[]> {
		// One query. No N+1. No pagination of all keys.
		const { data, error } = await this.client
			.from('pastes')
			.select('*')
			.eq('visibility', 'public')
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false })
			.limit(limit);

		if (error || !data) return [];

		return data.map((row: any) => PasteFactory.fromData(this.mapRow(row)));
	}

	async resolveSlug(slug: string): Promise<string | null> {
		const { data } = await this.client
			.from('slugs')
			.select('paste_id')
			.eq('slug', slug)
			.gt('expires_at', new Date().toISOString())
			.single();

		return data?.paste_id ?? null;
	}

	async saveSlug(slug: string, pasteId: string, expiresAt: Date): Promise<void> {
		const { error } = await this.client.from('slugs').insert({
			slug,
			paste_id: pasteId,
			expires_at: expiresAt.toISOString(),
		});

		if (error) throw new Error(`Failed to save slug: ${error.message}`);
	}

	// Map Postgres snake_case row to PasteData camelCase
	private mapRow(row: any): PasteData {
		return {
			id: row.id,
			content: row.content,
			title: row.title,
			language: row.language,
			createdAt: row.created_at,
			expiresAt: row.expires_at,
			visibility: row.visibility,
			burnAfterReading: row.burn_after_reading,
			readCount: row.read_count,
			isEncrypted: row.is_encrypted,
			viewLimit: row.view_limit,
			version: row.version,
			deleteToken: row.delete_token,
		};
	}
}
```

---

## Migration Plan (Incremental)

### Phase 0: Setup (Day 1)

- Create a Supabase project (EU region -- Frankfurt, matches your Cloudflare setup)
- Run the schema migration (tables, indexes, RLS, pg_cron jobs, view_paste function)
- Create Supabase project, run schema migrations (Phase 0 complete ✓)
- Add `@supabase/supabase-js` to package.json ✓
- Add `SUPABASE_URL` as a var in `wrangler.jsonc`
- Add `SUPABASE_SECRET_KEY` as a Wrangler secret (`wrangler secret put SUPABASE_SECRET_KEY`)
- Add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `STORAGE_BACKEND` to the `Env` interface in `types.ts`
- Note: use the new `sb_secret_...` key format (Dashboard → Integrations → Data API → Settings → API Keys)

### Phase 1: Dual-Write ✓ COMPLETE

**Files created:**
- `src/infrastructure/storage/supabasePasteRepository.ts` -- implements all 6 `PasteRepository` methods
- `src/infrastructure/storage/dualWriteRepository.ts` -- shadow-write wrapper
- `src/tests/infrastructure/storage/supabasePasteRepository.test.ts` -- 14 tests
- `src/tests/infrastructure/storage/dualWriteRepository.test.ts` -- 11 tests

**Files modified:**
- `src/types.ts` -- added `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `STORAGE_BACKEND` to `Env`
- `src/index.ts` -- feature-flag logic, `pasteRepository` in Hono context
- `wrangler.jsonc` -- `SUPABASE_URL` and `STORAGE_BACKEND=dual` in vars

**Key implementation decisions:**
- `upsert` not `insert` -- `save()` is called for both creates and read-count increments
- PGRST116 error code handled silently as not-found (no log noise)
- `{ count: 'exact' }` on delete to return accurate `boolean`
- `expires_at` filter on `findRecentPublic` and `resolveSlug` -- pg_cron cleanup has up to 5-min lag
- Secondary failures in `DualWriteRepository` are logged but never thrown
- `pasteRepository` added to Hono context so slug handler uses the correct backend

**To deploy Phase 1:**
```bash
# Deploy with dual-write active
wrangler deploy --env production
```

**To verify data landing in Supabase:**
```sql
-- Run in pgpasteriser after creating a paste on paste.erfi.io
SELECT id, title, visibility, created_at FROM pastes ORDER BY created_at DESC LIMIT 5;
```

### Phase 2: Read from Supabase ✓ SKIPPED

Phase 2 (dual reads) was skipped. After verifying Phase 1 data was clean:
- Only 1 paste existed in Supabase (the test paste)
- Pastes expire -- no critical data loss from skipping
- Cut directly to Phase 3

### Phase 3: KV Removal ✓ COMPLETE

- `STORAGE_BACKEND=supabase` deployed to production
- KV namespace retained in `wrangler.jsonc` bindings for rollback safety (unused)
- Verified: new pastes land in Supabase directly, UUIDv7 ordering confirmed

**Rollback:** Change `STORAGE_BACKEND` back to `dual` or `kv` in `wrangler.jsonc` and redeploy. No data migration needed.

**KV cleanup (when ready):**
1. Confirm no active KV pastes worth keeping
2. Remove `kv_namespaces` from `wrangler.jsonc`
3. Remove `PASTES: KVNamespace` from `src/types.ts`
4. Remove `KVPasteRepository` instantiation from `src/index.ts`

### Phase 3.5: Post-Migration Audit and Fixes ✓ COMPLETE

After Phase 3, ran a verification pass against the live system and Supabase
docs (`docs.erfi.io`). Two real issues found and fixed:

**1. `set_updated_at` trigger fired on every save**

The trigger was scoped to `BEFORE UPDATE OF content, title`, expecting it
to skip read-count increments. But `UPDATE OF col` fires whenever those
columns appear in the SET clause, not when their values change. Since
`save()` uses `upsert()` (which sends all columns), the trigger fired on
every read-count increment.

Symptom: `updated_at - created_at` grew ~500ms per read even though
content/title were unchanged.

Fix (migration `20260511124104_fix_updated_at_trigger.sql`): add a `WHEN`
clause comparing `OLD.col IS DISTINCT FROM NEW.col`. This is the canonical
Postgres pattern documented in
[CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html).

Verified after deploy: created paste, viewed 3 times. `updated_at` stayed
at `12:57:18.042025` while `read_count` went 0 → 3.

**2. `createClient` missed server-side auth options**

`SupabasePasteRepository` and `scripts/smoke-test.ts` were calling
`createClient(url, key)` without the auth options block Supabase
[recommends](https://supabase.com/docs/guides/functions/unit-test) for
non-browser contexts. Defaults assume a browser:

- `persistSession: true` tries to read/write `localStorage` (no-op in
  Workers, warns in Node)
- `autoRefreshToken: true` schedules a `setTimeout` to refresh the JWT
  (wasted work for service_role/secret keys, can keep one-shot Node scripts
  alive after the work is done)
- `detectSessionInUrl: true` parses OAuth callback params from
  `window.location` (nonsense outside a browser)

Fix: pass `{ auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }`
to `createClient` everywhere.

**Verification additions:**
- `scripts/smoke-test.ts` (10 API + 9 DB/RLS tests) runs against
  `paste.erfi.io` and queries Supabase directly. Adds RLS coverage:
  publishable key cannot SELECT private pastes, CAN SELECT public ones.
- `TEST-REPORT.md` documents the full audit (test results, schema state,
  RLS check, pg_cron status, findings).

### Phase 4: New Features (Week 2+)

Now that you have Postgres, build features KV couldn't support.

#### 4.1: `view_paste()` RPC ✓ COMPLETE

Migration `20260511130427_add_view_paste_rpc.sql`: PL/pgSQL function that
encapsulates the entire read flow (find + increment + burn + view-limit)
in a single transaction with `SELECT ... FOR UPDATE` row locking.

**Why:** The previous flow was 3 round-trips (SELECT → UPDATE → maybe
DELETE). Two concurrent reads of a burn-after-reading paste could both
pass the SELECT, both bump read_count, both serve content, then both
DELETE -- content served twice instead of once. KV has no row-lock
primitive so the race was unfixable there. Postgres `FOR UPDATE` makes
it trivially correct.

**Domain changes:**
- New method on `PasteRepository`: `view(id): Promise<ViewResult>` where
  `ViewResult = { paste, wasBurned, wasViewLimited }`.
- `SupabasePasteRepository.view()` calls `rpc('view_paste', ...)`.
- `KVPasteRepository.view()` mirrors the old multi-step logic (race
  documented in the doc comment -- kept for rollback safety only).
- `DualWriteRepository.view()` delegates to primary only (shadow-viewing
  to secondary would double-count or double-burn).
- `getPasteQuery.execute()` collapsed from 50 lines of orchestration to
  a 3-line wrapper that calls `repository.view(id)`.

**Verification:** `npm run test:race` — 5 fresh burn-after-reading pastes,
20 parallel views each (100 requests total). Expected exactly 5 wins
(one per paste) and 95 404s. Run in production after the deploy:

```
Run 1/5: ✓ wins=1 (expected 1)  misses=19
Run 2/5: ✓ wins=1 (expected 1)  misses=19
Run 3/5: ✓ wins=1 (expected 1)  misses=19
Run 4/5: ✓ wins=1 (expected 1)  misses=19
Run 5/5: ✓ wins=1 (expected 1)  misses=19

Totals: 5 wins, 95 misses. Result: RACE-FREE ✓
```

**Function security:** `SECURITY DEFINER` so the function runs as its
owner (postgres) and can DELETE rows regardless of caller. `SET
search_path = ''` forces all table references to be schema-qualified
(`public.pastes`) — defends against search-path attacks where someone
creates a malicious table in their own schema to shadow `pastes`.
Execution permission revoked from PUBLIC and granted only to
`service_role`.

#### 4.2: Full-text search ✓ COMPLETE

Migration `20260511131541_add_paste_search.sql` adds a generated tsvector
column and a GIN index. Search is exposed via the new `GET /api/search?q=...`
endpoint backed by `PasteRepository.searchPublic(query, limit)`.

**Schema:**

```sql
ALTER TABLE pastes
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(language, ''))
  ) STORED;

CREATE INDEX idx_pastes_search ON pastes USING GIN (search_vector);
```

The `STORED` generated column keeps the tsvector in sync with `title +
language` automatically -- no trigger needed. GIN is the standard index
type for tsvector membership (`@@`) queries.

**Why title + language only, not content?** Most pastes are code or
encrypted ciphertext. The English snowball stemmer in `to_tsvector`
expects natural language; tokenizing `abcdefgh==` yields one big garbage
token that matches nothing. Indexing content would bloat the GIN index
without improving discoverability. For code search you'd want pg_trgm
trigram indexes (different feature).

**Query side:**

```typescript
await client.from('pastes')
  .select('*')
  .eq('visibility', 'public')
  .gt('expires_at', new Date().toISOString())
  .textSearch('search_vector', query, { type: 'websearch', config: 'english' })
  .order('created_at', { ascending: false })
  .limit(20);
```

`type: 'websearch'` translates to `websearch_to_tsquery()` which parses
user input safely: `"foo bar"` becomes a phrase match, `foo OR bar`
becomes an alternation, `-foo` excludes, etc. Malformed input degrades
gracefully (no parser errors thrown to clients).

`config: 'english'` must match the config used in the generated column.
The stemmer normalizes `running -> run`, `tests -> test`, so the query
side needs the same stemmer to align.

**Domain changes:**
- New method `PasteRepository.searchPublic(query, limit)`.
- Supabase implementation uses `.textSearch()`.
- KV implementation returns `[]` (no search primitive; documented as
  intentional, not a TODO).
- `SearchPastesQuery` application class mirrors `GetRecentPastesQuery`
  shape (same DTO).
- `GET /api/search?q=...&limit=...` route. Limit clamped to [1, 50].
  Query string capped at 200 chars. Empty/whitespace `q` returns `[]`
  without hitting the DB.

**Verification:**
- 11 new unit tests across repository implementations + handler.
- Smoke test (`npm run test:smoke`) creates a paste with a unique
  token-bearing title, searches for the token, asserts the paste is
  returned. Also asserts private pastes are excluded from search
  results, and that `search_vector` is populated correctly.

**User accounts** (exercises: Supabase Auth + RLS)

- Add Supabase Auth (anonymous sessions -> optional signup)
- Link pastes to `auth.users` via `user_id` column
- "My Pastes" page using RLS (user only sees their own)
- Authenticated users don't need `deleteToken` -- RLS handles it

#### 4.3: Live recent feed via Realtime broadcast ✓ COMPLETE

Migration `20260511132703_realtime_public_paste_feed.sql` adds a
trigger that broadcasts public paste inserts to a private Realtime
channel. The frontend `/recent` page subscribes and prepends new
pastes to the list without polling.

**Why broadcast and not Postgres Changes:**

Supabase docs explicitly recommend Broadcast over Postgres Changes for
production — Postgres Changes streams the entire publication to every
subscriber and runs RLS per-row per-subscriber, which doesn't scale.
Broadcast lets the trigger build a curated payload (no sensitive
fields) and emit it once per public insert.

**Defense in depth: three independent layers protect against private-paste leaks:**

1. **Trigger filter (`visibility = 'public'`)** — private pastes never
   reach `realtime.send()`. Earliest possible filter.
2. **Curated payload** — only `id`, `title`, `language`, `createdAt`,
   `expiresAt`, `readCount`, `isEncrypted`, `version` are broadcast.
   Never `content`, `delete_token`, or `user_id`. Even if the schema
   grows new fields, they don't accidentally leak.
3. **Private channel + RLS** — `is_private = true` requires
   subscribers to satisfy a SELECT policy on `realtime.messages`.
   The policy only allows `anon` and `authenticated` to receive from
   the exact topic `recent:public`. Any other topic from a buggy
   trigger would be filtered server-side.

**Encryption / visibility dimension matrix:**

Pastes have two orthogonal dimensions: visibility (public | private)
and encryption (plaintext | client-side E2EE). All four combinations
handled:

| Visibility | Encryption | Broadcast? | Notes |
|------------|-----------|------------|-------|
| public | plaintext | yes (metadata only) | mirrors `/api/recent` |
| public | E2EE | yes (metadata only) | title may itself be ciphertext; client renders accordingly |
| private | plaintext | **no** | trigger filter blocks |
| private | E2EE | **no** | trigger filter blocks |

E2EE encryption keys live only in the URL fragment (`#hash`), never
in the DB, so they cannot reach Realtime under any path. Passwords
were removed entirely in the earlier Phase 4 cleanup.

**Trigger semantics for upsert:**

`save()` upserts the row on every read-count increment. `AFTER INSERT
OR UPDATE` would fire on every read. `AFTER INSERT` only fires on
*actual* INSERT, not on `INSERT ... ON CONFLICT DO UPDATE` that
resolved to UPDATE. Verified empirically (see `npm run test:realtime`).

**Verification (`npm run test:realtime`):**

13 checks across 3 groups:

1. End-to-end pipeline:
   - Subscribe as anon to `recent:public` (private channel)
   - Create public paste → broadcast received
   - Create private paste → no broadcast (trigger filter)
   - Payload contains only the 8 safe fields
   - Read-count upsert (UPDATE) does NOT fire the INSERT trigger
2. Compatibility matrix (key types × channel types × setAuth) — all
   key formats work with private channels.
3. Negative tests — subscribing to a disallowed topic returns
   `Unauthorized: You do not have permission to receive messages from
   this topic`.

See `postgres-learnings.md` "Supabase Realtime" section for the full
limitations matrix.

#### 4.4a: RLS for authenticated users ✓ COMPLETE

Migration `20260511140659_authenticated_rls_policies.sql` adds 5 RLS
policies on `public.pastes` for the `authenticated` role:

| Policy | Operation | Predicate |
|--------|-----------|-----------|
| `authenticated can view public pastes` | SELECT | `visibility = 'public'` (mirrors the anon policy) |
| `authenticated can view own pastes` | SELECT | `(SELECT auth.uid()) = user_id` |
| `authenticated can create own pastes` | INSERT | WITH CHECK `(SELECT auth.uid()) = user_id` |
| `authenticated can update own pastes` | UPDATE | USING + WITH CHECK both pin `auth.uid() = user_id` |
| `authenticated can delete own pastes` | DELETE | USING `(SELECT auth.uid()) = user_id` |

All policies use `(SELECT auth.uid())` not bare `auth.uid()` — Postgres
runs it once per statement via initPlan instead of once per row.
Supabase RLS benchmarks: 94-99% improvement at scale.

The Worker continues using `service_role` (RLS bypass). These policies
activate when:

- Frontend queries Supabase directly with a user JWT (`/my` page,
  Phase 4.4c)
- Future endpoints might run under authenticated context
- Defense in depth if a Worker bug ever exposes the wrong rows

#### 4.4b: Worker JWT verification + user_id passthrough ✓ COMPLETE

**`AuthService`** (`src/infrastructure/auth/authService.ts`):
- Constructs its own Supabase client with the secret key + standard
  server-side auth opts
- `getUserIdFromRequest(request)` extracts the bearer token from
  `Authorization: <jwt>`, calls `supabase.auth.getUser(jwt)` to
  verify, returns user id or null
- Case-insensitive bearer prefix handling
- Logs at debug for invalid tokens (likely user noise), warn for
  network failures (operational signal)
- Cost: one round-trip per authenticated request. Acceptable for
  pastebin throughput. For higher scale, switch to `getClaims()`
  (local JWKS-based verification).

**Domain model:**
- `Paste` gains a `userId?: string` field, accessor, factory and
  rehydration support
- `Paste.toJSON(includeSecrets = true)` now includes `userId` along
  with `deleteToken` (only for persisting, never in API responses)
- `incrementReadCount()` preserves userId

**Application:**
- `CreatePasteCommand.execute(params, opts: { userId? })` — userId
  comes from the verified JWT, NEVER from the request body
  (impersonation guard)

**Infrastructure:**
- `SupabasePasteRepository.save()` now sends `user_id` in the upsert
  (nullable, defaults to null for anonymous pastes)
- `SupabasePasteRepository.mapRow()` reads `user_id` and exposes it
  as `userId` in `PasteData`

**Handler:**
- `ApiHandlers` gains an optional `authService` constructor arg
- `handleCreatePaste()` calls `authService.getUserIdFromRequest()`
  if configured; passes the result (or undefined) into the command
- Anonymous requests (no/invalid JWT) get `userId = undefined` and
  produce anonymous pastes (`user_id = NULL`)
- `handleUpdatePaste()` preserves `userId` when reconstructing the
  Paste — fixes an orphan bug that would have erased ownership on
  every update

**Tests added:**

| File | New tests |
|------|----------:|
| `authService.test.ts` (new) | 7 |
| `createPasteCommand.test.ts` | 2 (userId pass-through + anon) |
| `supabasePasteRepository.test.ts` | 4 (save user_id, save null, mapRow user_id, mapRow null) |
| `handlers.test.ts` | 3 (JWT → userId, no authService, invalid JWT) |

151 unit tests total (was 135).

**Live verification (`npm run test:rls`):**

`scripts/verify-rls.ts` creates two Supabase Auth users via the admin
API, signs them in, and verifies 13 RLS scenarios:

1. Worker accepts JWT and persists user_id on the paste row
2. Anonymous paste creation (no JWT) still works (user_id = NULL)
3. User A can SELECT their own private paste via direct DB + JWT
4. User A CANNOT SELECT user B's private paste (RLS blocks)
5. Both users CAN SELECT public pastes from each other
6. User A's "my pastes" via RLS contains only their own rows
7. User A can DELETE their own paste via direct DB + JWT
8. User A CANNOT DELETE user B's paste (count = 0, no error)
9. INSERT with mismatched user_id is rejected by RLS WITH CHECK
   with `new row violates row-level security policy for table "pastes"`

All 13 pass against production. Cleanup deletes test users + their
pastes; no residue in the live DB.

#### 4.4c: Frontend login + /my page ✓ COMPLETE

Three new Astro pages and four React islands. All driven by a shared
browser-side Supabase client.

**Shared infrastructure:**

- `astro/src/lib/supabase.ts` — browser client singleton. Lazy
  init, returns null when env vars missing (graceful degradation).
  Browser auth opts enabled (persistSession, autoRefreshToken,
  storageKey scoped to `pasteriser-auth`).
- `astro/src/hooks/useAuth.ts` — React hook returning `{ user,
  session, loading, signIn, signUp, signOut }`. Subscribes to
  `onAuthStateChange` for live state. Cleans up on unmount.

**Components:**

- `UserMenu.tsx` — header island. Shows avatar circle when signed
  in (with a dropdown for My Pastes / Sign out), "Log in" link
  otherwise. Hides entirely when auth not configured.
- `AuthForm.tsx` — login/signup combined (mode prop). Email +
  password (min 6 chars). Shows "check your email" notice when
  the project requires email confirmation. Redirects to `/my`
  on success.
- `MyPastes.tsx` — `/my` page island. Queries `pastes` table
  directly via supabase-js. **No server-side filter clause** —
  RLS does the filtering. Delete uses direct DB delete too;
  cross-user delete attempts return count = 0 silently.

**Pages:**

- `/login` → `AuthForm mode="login"`
- `/signup` → `AuthForm mode="signup"`
- `/my` → `MyPastes` (shows sign-in prompt if not authenticated)

Routes added to the Worker so it knows to serve the corresponding
Astro static HTML.

**Existing components updated:**

- `Header.tsx` mounts `UserMenu` and adds a "My Pastes" link in
  the mobile menu.
- `PasteForm.tsx` reads the current Supabase session before posting
  to `/pastes` and adds `Authorization: Bearer <jwt>` when signed
  in. Anonymous behavior unchanged.

**Astro env:**

`PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Vite
bakes them into the client bundle at build time). Already added
in Phase 4.3 for the live recent feed.

**Verification path:**

1. Open `https://paste.erfi.io/signup`, create an account.
2. After email confirmation (or immediately if disabled in the
   project's auth settings), log in at `/login`.
3. Create a paste with `Private` visibility.
4. Navigate to `/my` — the private paste appears.
5. Sign out, navigate to `/my` — see the sign-in prompt.
6. Other users do NOT see your private paste (verified
   programmatically by `npm run test:rls`).

#### 4.4d: Server-side email confirmation (Path C) ✓ COMPLETE

The Worker is now the landing page for Supabase Auth confirmation
emails (signup, recovery, magic-link, email change). This is the
"Path C" pattern from the official Supabase Next.js SSR guide,
adapted to a Hono + Workers + Astro BFF.

**Why:** the default Supabase confirmation email points to
`https://<project>.supabase.co/auth/v1/verify?token=...&redirect_to=<SiteURL>`,
which lands on Supabase's domain and sets session cookies for
`.supabase.co` — useless to us because our cookies are scoped to
`paste.erfi.io` and CSP forbids browser→Supabase calls. Path C
flips the verification flow: the email link points to our domain,
the Worker does the token exchange server-side, the Worker sets
its own HttpOnly cookies, then 302s the user into the app.

**Worker route (`src/index.ts:213`):**

```ts
app.get('/auth/confirm', async (c) =>
  preventCaching(await c.get('authHandlers').handleConfirm(c.req.raw)));
```

**Handler (`src/interfaces/api/authHandlers.ts:228`):**

1. Read `?token_hash=...&type=...&next=...` from the URL.
2. Whitelist `next` to same-origin paths only (`startsWith('/')
   && !startsWith('//')`) — defends against open-redirect attacks.
3. Whitelist `type` to the set Supabase Auth accepts:
   `signup | recovery | invite | email_change | magiclink | email`.
4. Call `supabase.auth.verifyOtp({ token_hash, type })` — server-side
   token exchange. Returns a `Session` with `access_token` +
   `refresh_token` on success.
5. Build a 302 to `next` (default `/`), attach the standard
   `applySessionCookies(response, access, refresh)` cookies.
6. On any failure (missing params, invalid type, expired token),
   302 to `/login?error=<code>` so the user lands somewhere with a
   clear failure message and no half-set cookies.

**Supabase Auth config — patched via Management API (no Dashboard
click-ops):**

```bash
SB_TOKEN=$(cat ~/.supabase/access-token)
curl -X PATCH \
  -H "Authorization: Bearer $SB_TOKEN" \
  -H "Content-Type: application/json" \
  -d @auth-patch.json \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth"
```

Where `auth-patch.json` sets:

- `site_url`: `https://paste.erfi.io` (was `http://localhost:3000`)
- `uri_allow_list`: `https://paste.erfi.io/auth/confirm,https://paste.erfi.io/my,https://paste.erfi.io/`
- `mailer_templates_confirmation_content`: rewritten to use
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/my`

**Critical gotcha**: the type query param MUST be **hardcoded** —
`{{ .EmailActionType }}` is NOT a valid template variable on the
confirmation email context, despite being widely cited (incl. older
versions of the official docs). When that variable was used, the
link rendered with `&type=&` (empty value), and `/auth/confirm`
correctly rejected it with `error=invalid_type`. The same applies
to every other email template:

- `mailer_templates_confirmation_content` → `type=signup`
- `mailer_templates_recovery_content` → `type=recovery`
- `mailer_templates_magic_link_content` → `type=magiclink`
- `mailer_templates_invite_content` → `type=invite`
- `mailer_templates_email_change_content` → `type=email_change`

All five templates have been preemptively patched to use hardcoded
type values via the same Management API call.

The Management API endpoint is `PATCH /v1/projects/{ref}/config/auth`.
GET the same endpoint to inspect current config. The field names
are stable across the Supabase Auth (GoTrue) version — `site_url`,
`uri_allow_list` (comma-separated string, not JSON array),
`mailer_templates_*_content` (full HTML body).

**End-to-end live verification (run after deploy):**

```bash
# 1. Generate a real hashed_token via admin API
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"signup","email":"test@example.com","password":"testpassword123"}' \
  "$SUPABASE_URL/auth/v1/admin/generate_link")
HASHED=$(echo "$RESPONSE" | jq -r .hashed_token)

# 2. Hit /auth/confirm with that token
curl -s -i "https://paste.erfi.io/auth/confirm?token_hash=$HASHED&type=signup&next=/my" \
  -o /tmp/confirm.txt
grep -iE "^(http|location:|set-cookie:)" /tmp/confirm.txt

# Expected:
#   HTTP/2 302
#   location: https://paste.erfi.io/my
#   set-cookie: sb-access-token=<JWT>; HttpOnly; Secure; SameSite=Strict; Max-Age=3600
#   set-cookie: sb-refresh-token=<token>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
```

Decode the JWT and confirm `sub` matches the user, `role=authenticated`,
`user_metadata.email_verified=true`.

**Unit tests (5 cases in `authHandlers.test.ts` for `handleConfirm`):**

- `redirects to /login?error=missing_token when token_hash missing`
- `redirects to /login?error=invalid_type for unknown type`
- `sets cookies and 302s to next on successful verifyOtp`
- `rejects external-host next` (open-redirect defense)
- `302s to /login?error=... when verifyOtp fails`

**Patterns deliberately reused** from `acme-corp/src/app/auth/callback/route.ts`
(the Next.js SSR reference): same `verifyOtp({ token_hash, type })`
call, same query param shape, same same-origin redirect guard. The
Workers port is ~30 lines because the BFF cookie helpers are
already in place.

#### 4.4d-extras: auth UX polish + Resend SMTP + handler bug fixes (3.5.0)

After the initial Path C ship, a real-user signup flow surfaced
additional issues:

**Duplicate-email signup UX.** Supabase's anti-enumeration default
returns a *success-shaped* response when the email is already
registered — same `{ user, session }` shape, but `user.identities`
is an empty array. The frontend was treating that as
`needsConfirm: true` → user told to check an email that was never
sent. Fix: detect the empty-identities case in `handleSignup` and
return `HTTP 409 { code: "email_taken" }`. Documented trade-off:
this deliberately leaks "email exists" — we rely on Phase 4.7
rate limits + future captcha/honeypot for enumeration defense, not
on response-shape obfuscation.

**Login "wrong password" vs "not confirmed".** `handleLogin` was
collapsing both into HTTP 401 `invalid_credentials`, leaving users
who knew their password but hadn't clicked the email dead-ended.
Supabase's `signInWithPassword` returns `error.code = 'email_not_confirmed'`
ONLY when the password is correct (wrong-password against an
unconfirmed user still returns `invalid_credentials`, preserving
anti-enumeration). Surface that distinction: 403 `email_not_confirmed`
with a clear actionable message, 401 `invalid_credentials`
otherwise.

**Resend confirmation endpoint.** New `POST /api/auth/resend-confirmation`
handler + route. Calls `supabase.auth.resend({ type: 'signup', email })`.
Always returns 200 (Supabase's own rate limit gates abuse). The
frontend uses it from two places:
1. Inline link under the "Please confirm your email" error on /login
2. "Didn't get it? Resend" button on the signup success panel

**Frontend: signup success state replaces the form entirely.**
Previously the form stayed visible with a banner underneath ("Check
your email at X") — confusing dangling state. Now the card replaces
with a dedicated success panel that has the email address, a Resend
button, and a "Wrong email? Try again" reset button.

**Frontend: MyPastes leaked internals.** `MyPastes.tsx` had a copy
saying "Listed via the Worker; Supabase access goes through
service_role + an explicit `user_id` filter." That string was
end-user visible. Replaced with a small "{n} pastes" + "New paste"
CTA.

**Custom SMTP via Resend** (also via Management API PATCH):

```json
{
  "smtp_host": "smtp.resend.com",
  "smtp_port": "465",
  "smtp_user": "resend",
  "smtp_pass": "<resend api key>",
  "smtp_admin_email": "noreply@erfi.io",
  "smtp_sender_name": "Pasteriser",
  "smtp_max_frequency": 1,
  "rate_limit_email_sent": 30
}
```

The Resend domain `erfi.io` is verified (region `eu-west-1`).
`rate_limit_email_sent` bumped 2/hr → 30/hr — the inbuilt 2/hr was
the bottleneck behind today's "email rate limit exceeded" errors.

**Delete-paste handler method bug.** `handleDeletePaste` had a
method-discrimination bug: read the JSON body only when
`request.method === 'DELETE'`. The router (via `app.on(['DELETE',
'POST'], ...)`) accepts both methods on `/pastes/:id/delete`, so
POST + JSON body silently fell through to query-param-only auth
and returned 403 every time. `verify-realtime.ts` cleanup uses
POST + body and was therefore leaking 2 pastes per run for the
entire history of the realtime test. 47 leaked pastes wiped from
production. 2 new regression unit tests guard both methods.

**Cleanup-leak audit:**

- `verify-realtime.ts`: 18 leaks. Sending `{ deleteToken }` not
  `{ token }` in body (handler reads `body.token`). Also exposed
  the method-discrimination bug above. Both fixed.
- `smoke-test.ts`: 22 leaks. Two search-test `createPaste` calls
  were not pushing to `createdIds`. Fixed.
- All cleanup paths now `console.warn` on failure rather than
  silently swallowing with `.catch(() => {})`, so future leaks
  surface immediately.

#### 4.4e: OAuth providers (planned, not yet started)

Email + password and email-confirm flows are implemented. Next
iteration adds OAuth — GitHub first because it's the most useful
for developers and needs no email-server config. Reference:
`~/supabase/acme-corp/src/app/login/page.tsx` shows the exact
`signInWithOAuth` pattern.

**What to add (estimated ~1 hour of work):**

1. Configure GitHub OAuth in the Supabase Dashboard
   (Authentication → Providers → GitHub). Add a GitHub OAuth app
   with callback `https://<project-ref>.supabase.co/auth/v1/callback`.

2. Add a "Continue with GitHub" button to `AuthForm.tsx`:

   ```tsx
   async function handleGitHub() {
     await supabase.auth.signInWithOAuth({
       provider: 'github',
       options: { redirectTo: `${window.location.origin}/auth/callback` },
     });
   }
   ```

3. Create `astro/src/pages/auth/callback.astro` that calls
   `supabase.auth.exchangeCodeForSession(code)` from the URL and
   redirects to `/my`. (For Astro static + supabase-js with
   `detectSessionInUrl: true` this is often handled automatically;
   only need a callback page if the project uses the PKCE flow.)

No backend changes — the JWT from any OAuth provider is just another
Supabase Auth JWT, validated by the existing `AuthService`. RLS
policies match on `auth.uid()` which is the same UUID regardless of
the sign-in method.

**Other providers worth considering:** Google (broadest reach),
Magic Link / OTP (no password to manage, low-friction).

#### 4.5: Analytics ✓ COMPLETE

Migration `20260511150017_add_paste_stats.sql` adds the function;
exposed via `GET /api/stats` (edge-cached 5min + SWR 15min). Empty-state
verified after the Phase 5 wipe: `totalPublic: 0`, all arrays/objects empty.

Postgres function `paste_stats()` returns a jsonb summary with five aggregates:

```sql
CREATE OR REPLACE FUNCTION public.paste_stats()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'totalPublic', (SELECT count(*) FROM pastes WHERE visibility = 'public'),
    'byLanguage', (
      SELECT jsonb_agg(jsonb_build_object('language', language, 'count', c))
      FROM (
        SELECT coalesce(language, 'unknown') AS language, count(*) AS c
        FROM pastes WHERE visibility = 'public'
        GROUP BY language ORDER BY c DESC LIMIT 20
      ) t
    ),
    'byHour', (
      SELECT jsonb_agg(jsonb_build_object('hour', hour, 'count', c) ORDER BY hour DESC)
      FROM (
        SELECT date_trunc('hour', created_at) AS hour, count(*) AS c
        FROM pastes WHERE visibility = 'public'
          AND created_at > now() - interval '48 hours'
        GROUP BY hour
      ) t
    ),
    'encryption', (
      SELECT jsonb_object_agg(version, c)
      FROM (
        SELECT version, count(*) AS c FROM pastes
        WHERE visibility = 'public' GROUP BY version
      ) t
    )
  );
$$;
```

`LANGUAGE sql STABLE` not `plpgsql` — pure aggregates, no control
flow needed, lets the planner inline if useful.

**Exposure:**
- `GET /api/stats` endpoint (Worker calls `client.rpc('paste_stats')`)
- Cached at edge (5min maxAge + SWR) — stats don't change second-by-second
- Optional `/stats` Astro page with charts (skip first iteration; the
  JSON endpoint is the deliverable)

**Tests:** 3 repo tests (mocked RPC: happy path, error, non-object data) +
2 handler tests (200 with payload, 503 when null).

#### 4.7: Anti-abuse and rate-limit hardening (planned, not yet started)

**Why this matters:** This is a well-documented, recurring attack
pattern against Supabase projects. Citations:

- *vibe-eval.com honeypot study (Apr 2026):* Leaked anon keys
  receive their first malicious request in a median of **11
  minutes**, fastest 47 seconds. 80% of honeypots received 100+
  requests in the first 24 hours. Every probe starts with
  `/rest/v1/?select=*` schema introspection, followed by mass
  table enumeration. The decisive defense is RLS-correctness, not
  key-rotation.
- *Supabase Auth issues #1236, #1932, #2333, #10850:* Multiple
  open/recently-fixed bugs in the Auth rate limiter. Failed
  signups still consume the email quota; the configurable rate
  limit is not enforced as configured; rate limit doesn't apply
  to already-used emails; email auth provider rate-limits other
  providers via shared limiters. Real reports of projects DoS'd
  by ~50 bad requests/hour.
- *r/SaaS / Hacker News recurring threads:* "Woke up to 500+ fake
  signups overnight" is a standard milestone for any Supabase
  project that opens signup without CAPTCHA. Bots drain email
  quotas, poison sender reputation, fill `auth.users`.
- *Supabase docs (`auth-anonymous.md:247`, `auth-captcha.md`):*
  Explicitly recommend Cloudflare Turnstile or hCaptcha on every
  anonymous flow.

**Pasteriser's current exposure:**

| Surface | What's there now | Gap |
|---------|------------------|-----|
| RLS on `pastes`/`slugs` | 6 policies, verified by `test:rls` | ✓ Honeypot study would find nothing |
| `anon` role permissions | `SELECT` only on public pastes/slugs | ✓ Minimal |
| Worker `POST /pastes` rate limit | 10/min per IP in-memory | ⚠ Per-isolate, no cross-colo coordination |
| `/auth/v1/signup` (browser → Supabase direct) | Supabase default | ✗ No CAPTCHA, no Worker gating |
| `/auth/v1/token` refresh | Supabase per-IP token bucket | ⚠ Buggy per #2333 |
| Email confirmation | Project default (likely on) | ✗ Inbuilt SMTP ~4/hour cap |
| Realtime subscriptions | None | ⚠ Free tier 200 concurrent connections |
| Paste size | 25 MiB max for all roles | ✗ Multi-IP attacker fills 500 MB DB in 20 requests |

**Mitigation order (tightest ROI first):**

**Design choice: no CAPTCHA.** CAPTCHAs are user-hostile, can be
defeated by paid solving services for ~$0.001 per solve, and the
Cloudflare-specific tracking is something we want to avoid. The
plan below achieves equivalent or better protection through other
means.

> **Filed for reference (not adopted):** Supabase has native support
> for Cloudflare Turnstile and hCaptcha via Dashboard → Authentication
> → Bot and Abuse Protection. Frontend gets a `captchaToken` from the
> widget, passes it to `supabase.auth.signUp({ email, password,
> options: { captchaToken } })`. Server rejects with HTTP 500
> `captcha verification process failed` if missing. Multiple blog
> posts (Sentinel, Discury) cite 92% bot-signup reduction in field
> data. If the OAuth-only + honeypot + Worker-gate stack ever proves
> insufficient, hCaptcha (not Cloudflare-owned) is the drop-in option
> — same Supabase integration path, no CF tracking.

| Priority | Action | Why first | Effort |
|----------|--------|-----------|--------|
| 1 | **OAuth-only signup** — disable email/password signup, force GitHub (primary) + optionally Google. Pattern from `acme-corp/src/app/login/page.tsx`. Disable email confirmation in Supabase Dashboard. | 95% of bot signup traffic disappears — bots can't easily mass-create GitHub accounts. Sidesteps every email-rate-limit bug. This is Phase 4.4d folded into 4.7. | 1-2h |
| 2 | **Cap anonymous paste size to 64 KiB** in the Zod schema. 1 MiB for authenticated users. 25 MiB never. | Storage flooding is the cheapest attack and most expensive to recover from. | 10 min |
| 3 | **Move signup behind the Worker** (`/api/auth/signup`) — browser POSTs to Worker, Worker enforces per-IP rate limit and IP/UA fingerprint heuristics, then calls Supabase Auth admin API with `Sb-Forwarded-For` header so its per-IP limits work correctly. | Defends against upstream Supabase Auth bugs (#2333 not enforcing config, #1236 failed signups counting). Worker rate limit doubles the gate. | 2-3h |
| 4 | **Honeypot field + timing check** in `AuthForm.tsx` and `PasteForm.tsx`. Invisible CSS-hidden `<input name="bait">` that bots fill; min-time-to-submit ≥ 1s. Reject submissions that fail either check. | Stops basic scripted bots without full browser emulation. Zero UX cost. | 30 min |
| 5 | **Tighten Supabase Auth rate limits** via Management API. Conservative caps (10 signups/hour/IP, 30 token refreshes/hour/IP). | Belt-and-suspenders even with Auth bugs. | 5 min |
| 6 | **Custom SMTP via Resend** ✓ DONE (3.5.0). `smtp.resend.com:465`, `noreply@erfi.io`, `rate_limit_email_sent` 2/hr → 30/hr. The inbuilt 2/hr was unusable. | — | — |
| 7 | **PostgREST-side per-IP rate limit** for browser-direct paths (`/my` reads, Realtime subscribes). `private.rate_limits` table + `before insert/update/delete` triggers per `supabase/guides/api/securing-your-api.md`. | Defense in depth — Worker rate limit doesn't gate direct DB queries. | 1h |
| 8 | **Per-account daily storage quota** in Postgres — `pastes` insert trigger that sums bytes per `user_id` and rejects if over the daily cap. | Catches the rare case where a single legitimate-looking user fills the DB. | 2h |

**Quick wins to ship today (~3h for #1, #2, #5):** removes the
most realistic abuse vectors. After:
- Bot signups blocked by GitHub-account-creation cost (~minutes + phone verification per account)
- Storage flooding capped at 64 KiB per anonymous paste
- Email rate limits inapplicable because email signup is disabled
- Worker rate limit still gates anonymous paste creation

**Live verification (would add `npm run test:abuse`):**

- Spam `POST /pastes` from one IP → assert Worker returns 429 by request N
- Spam `POST /pastes` rotating headers (X-Forwarded-For, User-Agent) → assert in-memory limiter still catches single source
- Try `auth.signUp` without Turnstile token → assert 500 (Supabase rejects unverified)
- Try a 30 MiB paste body → assert Zod schema rejection
- Try 250 simultaneous Realtime subscribes → assert `too_many_connections`
  is surfaced gracefully in the `/recent` UI

**This phase is scoped but not committed.** Recommended to ship
items #1-3 before opening the project to any public traffic beyond
single-user testing. Items #4-8 can wait for evidence of abuse.

#### 4.6: Expiration (already done)

Handled by the `cleanup-expired-pastes` pg_cron job since Phase 0.
KV TTL was the only cleanup mechanism before — Postgres gives both
automatic expiry AND queryable expired-but-not-yet-cleaned data.

---

## Phase 5: KV removal ✓ COMPLETE

Executed in one commit (see `94620f6 feat(phase-4.5+5)`). Done:

1. ✓ Wiped 81 paste rows from Supabase (confirmed clean slate for
   future testing).
2. ✓ Deleted the Cloudflare KV namespace `PASTES` (id
   `7ab6cc1ce0744c119c50554173707600`) via `wrangler kv namespace delete`.
3. ✓ Removed `kv_namespaces` block from `wrangler.jsonc` (top-level
   and production env) and the `STORAGE_BACKEND` var (no longer needed).
4. ✓ Removed `PASTES: KVNamespace` and `STORAGE_BACKEND` from
   `src/types.ts`.
5. ✓ Removed `KVPasteRepository` + `DualWriteRepository` imports
   and instantiation from `src/index.ts`. The Worker now instantiates
   `SupabasePasteRepository` directly with no backend selector.
6. ✓ Deleted `src/infrastructure/storage/kvPasteRepository.ts`,
   `dualWriteRepository.ts`, and both test files.
7. ✓ Deleted `src/tests/integration/routes.test.ts` (MockKV-coupled;
   every scenario it covered is now covered by the live smoke +
   RLS + race tests against production).

**Net change:** -926 lines across 20 files. No user-visible change.
After the wipe, `paste_stats()` returns `totalPublic: 0` and the
recent feed renders the empty state.

---

## Phase 6: Discord bot integration

**Goal:** wrap Pasteriser as a Discord slash-command bot so users can
share code that exceeds Discord's text and attachment limits (2000
chars free / 4000 Nitro, 25 MiB per file).

**Threat model + runtime:** the bot is a privileged client. It calls
Pasteriser via HTTPS and (optionally) Supabase via service_role.
From Pasteriser's POV the bot is one trusted backend, no different
from the Cloudflare Worker — the trust boundary is around the bot
process. The bot's runtime is *not* a browser; if we say "client-
side encryption" in this section we mean "bot-side, inside the bot
process before any network egress."

### Sub-phases

Plan is split into three deliverables of increasing scope. Ship 6a
first to validate deployment, then layer 6b/6c on top.

#### 6a: Anonymous-paste pipe (MVP)

Simplest viable bot. Forwards Discord input to Pasteriser as
anonymous public pastes. No encryption, no guild scoping.

**Slash commands:**

| Command | Argument schema | Behavior |
|---------|----------------|----------|
| `/paste` | `text:<string>` (Discord arg cap ~6000 chars) | Bot creates an anonymous public paste; replies with the URL |
| `/paste-long` | (opens a Discord modal with a textarea, 4000 chars/field) | Same as above; modal lets users avoid pasting in chat |
| `/paste-file` | `file:<attachment>` (Discord file ≤25 MiB) | Bot downloads, reads as UTF-8 (rejects binary), uploads as paste |

All three call the same internal `createPaste(text, language?)` flow.

**State:** none. The bot is stateless except for the Discord gateway
session. If the Unraid container restarts, no recovery needed.

**Effort:** ~1 day.

**Validates:** the deployment story (Deno + Docker + Unraid +
Pasteriser API HTTPS calls work as expected).

#### 6b: Per-paste E2EE

Adds an explicit "private" command that encrypts in the bot's
process before upload. Anyone with the Discord message can decrypt
because the URL fragment carries the key — the protection is
*against Pasteriser*, not against other Discord members.

**Slash commands added:**

| Command | Argument schema | Behavior |
|---------|----------------|----------|
| `/paste-e2ee` | `text:<string>` (or modal/file variants) | Bot generates a 256-bit AES-GCM key, encrypts content in-process, uploads ciphertext with `isEncrypted=true, version=2`, posts URL with `#key=<base64>` fragment |

**Crypto:**
- AES-GCM-256 via Deno's `crypto.subtle` (Web Crypto API — same code
  the Astro frontend uses, can vendor `astro/src/lib/crypto.ts`
  directly into the bot if convenient)
- 96-bit random IV per paste, prepended to ciphertext
- Key encoded with URL-safe base64 in the fragment

**Why "client-side encryption" still applies:** Pasteriser's DB
sees only ciphertext + IV. The key never touches an HTTP request
body or query string — only the URL fragment, which browsers do
not send to servers. Anyone who possesses the URL (i.e., any
Discord member who can read the channel where the bot posted) can
decrypt.

**Effort:** ~half a day on top of 6a.

#### 6c: Guild-scoped pastes (the ambitious one)

Per-Discord-server visibility, gated by Postgres RLS. Discord users
without guild membership cannot view a guild-scoped paste even with
the URL — Pasteriser API returns 404, browser can't decrypt
nothing.

**Schema additions (new migration):**

```sql
ALTER TABLE public.pastes
  ADD COLUMN guild_id text;  -- nullable; Discord snowflake string

CREATE INDEX idx_pastes_guild_id
  ON public.pastes (guild_id)
  WHERE guild_id IS NOT NULL;

-- Bot-maintained guild membership table.
CREATE TABLE private.guild_members (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guild_id text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, guild_id)
);

CREATE INDEX idx_guild_members_user_id
  ON private.guild_members (user_id);

-- SECURITY DEFINER lookup so RLS policy doesn't need a JOIN.
-- Performance-sensitive: this runs per row in the RLS check.
CREATE OR REPLACE FUNCTION public.is_in_guild(guild text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.guild_members
    WHERE user_id = (SELECT auth.uid())
      AND guild_id = guild
  );
$$;

-- Extend the authenticated SELECT policy.
DROP POLICY IF EXISTS "authenticated can view own pastes" ON public.pastes;
CREATE POLICY "authenticated can view own or guild pastes"
  ON public.pastes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (guild_id IS NOT NULL AND public.is_in_guild(guild_id))
  );
```

The `is_in_guild` SECURITY DEFINER function is the Supabase-
recommended way to avoid an RLS-level JOIN that defeats indexes
(see `supabase/guides/database/postgres/row-level-security.md`
"Minimize joins" section: 99.78% improvement in the benchmark).

**Discord ↔ Supabase user mapping:**
- For each Discord user who interacts with the bot, the bot creates
  a Supabase Auth user via `auth.admin.createUser({ email:
  '<discord-id>@bot.pasteriser.invalid', user_metadata: {
  discord_id, discord_username } })`. Email domain is sentinel —
  these users never sign in via password.
- Bot stores the resulting `auth.users.id` in its SQLite alongside
  the Discord user id.
- On Discord guild-member events (join/leave), bot upserts /
  deletes from `private.guild_members`.

**Slash commands:**

| Command | Behavior |
|---------|----------|
| `/paste-guild` | Like `/paste-e2ee` but sets `guild_id` to the current guild and uses a deterministic per-guild key derived from a master in the bot's SQLite. Members of the guild can decrypt; non-members get 404 from Pasteriser. |
| `/recent` | Lists 10 most recent guild-scoped pastes for the current guild. Calls Pasteriser as the bot's service-role user. |
| `/burn` | `id:<paste-id>` — delete a paste the user created. Verified via the per-user JWT. |

**Effort:** ~2 days (migration + bot crypto + member-sync + slash
commands + tests).

### Implementation details

#### Discord rate limits to design around

- Global per bot: 50 requests/sec
- Per channel: ~5 messages/sec
- Slash command registration: limited and slow — register once at
  deploy, not per-event
- `IDENTIFY` (gateway login): 1 per 5s, 1000 per day per bot token
- **Message Content intent is privileged** — only needed if the bot
  reads message body. For slash-command-only bots: not required.
  Pasteriser's bot stays slash-only so we don't hit the 100-guild
  verification gate.

#### Encryption key management options (for guild-scoped phase)

| Option | Trade-off |
|--------|-----------|
| Per-paste random key in URL fragment | Anyone with URL decrypts. Discord audit logs reveal URLs. Simplest. (This is 6b.) |
| Per-guild deterministic key in bot SQLite | All current guild members can decrypt with just the URL. Bot host has master access. RLS gates the *listing*; URL leakage still works. (This is 6c default.) |
| Hybrid: per-paste random key wrapped by guild master | Cleanest defense — Pasteriser sees only ciphertext + wrapped key. But wrapping key has to live somewhere; if in DB, bot's service-role can read it, defeating the point. Real benefit only if a separate key management service is added. Out of scope. |

6c default is the per-guild deterministic key. Document the trade-
off in the bot's README.

#### Bot's persistent state

`/data/state.sqlite` mounted from Unraid. Schema:

```sql
CREATE TABLE discord_users (
  discord_id  text PRIMARY KEY,
  supabase_id uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE TABLE guild_keys (         -- only 6c
  guild_id text PRIMARY KEY,
  key_b64  text NOT NULL,         -- 256-bit AES key, base64
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          timestamptz NOT NULL DEFAULT current_timestamp,
  discord_id  text,
  guild_id    text,
  command     text,
  paste_id    text,
  bytes       integer
);
```

Audit log helps with Discord ToS data-retention requests
(`/forget` command future work).

#### Container

```dockerfile
FROM denoland/deno:alpine
WORKDIR /app
COPY deno.json deno.lock src ./
RUN deno cache --reload src/main.ts
USER deno
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read=/data", "--allow-write=/data", "src/main.ts"]
```

Notes vs the previous draft:
- `denoland/deno:alpine` (no fictitious `-2` suffix)
- Explicit `--allow-read/--allow-write` scoped to `/data` (SQLite),
  not full filesystem
- `USER deno` (non-root in the published image)

#### Unraid template env

- `DISCORD_TOKEN` (secret)
- `DISCORD_APP_ID` (public; used for slash command registration)
- `DISCORD_PUBLIC_KEY` (public; for interaction signature verification
  if HTTPS interactions are used instead of gateway — not the MVP path)
- `PASTERISER_API_URL` (default: `https://paste.erfi.io`)
- `SUPABASE_URL` (only needed in 6c)
- `SUPABASE_SECRET_KEY` (only needed in 6c, secret)
- `BOT_DATA_DIR` (default `/data`)

#### Operational concerns

- **Resource footprint**: Deno + a single Discord gateway connection
  uses ~80-150 MiB RAM in steady state.
- **Networking**: outbound WSS to Discord, outbound HTTPS to
  Pasteriser, outbound HTTPS to Supabase (for 6c). No inbound.
- **Recovery**: container restart resumes gateway via Discord's
  resume protocol (built into the library); slash command state
  is in Discord's servers, no bot-side persistence needed for
  in-flight interactions.
- **Sharding**: not relevant until the bot is in many guilds.
  Discord recommends sharding at 1000+ guilds; for a personal bot
  this is years away.
- **Discord ToS**: bots must honor user data deletion within a
  reasonable window. Pasteriser already has `expires_at`. Add a
  `/forget` slash command that:
  - Deletes all `private.guild_members` rows for the calling user
  - Deletes their Supabase Auth user
  - Anonymizes the audit log (replace `discord_id` with `null`)
- **Logging**: bot logs to stdout (Docker captures). Audit log
  in SQLite keeps a 90-day rolling window via a daily prune
  (handled by a cron task inside the bot).

#### Things explicitly NOT in scope

- Sharding for high-guild deployment
- HTTPS interactions endpoint (gateway-based is simpler for a self-
  hosted bot)
- Message Content intent (slash-only avoids the privileged-intent
  paperwork)
- Edge Functions colocation (this is a Deno container, not a
  Supabase Edge Function — they share runtime but different
  deployment target)

### Repository layout

The bot lives in `bot/` under the Pasteriser repo. Same git history,
different deployment target. Top-level layout after Phase 6a:

```
pastebin/
├── src/             # Worker (existing)
├── astro/           # Frontend (existing)
├── supabase/        # Migrations (existing)
├── scripts/         # Live verification scripts (existing)
└── bot/             # Discord bot (new in 6a)
    ├── Dockerfile
    ├── deno.json
    ├── deno.lock
    ├── README.md
    └── src/
        ├── main.ts
        ├── commands/
        │   ├── paste.ts
        │   ├── paste-file.ts
        │   └── paste-long.ts
        ├── api.ts        # Pasteriser HTTP client
        └── env.ts
```

Future split into a sibling repo (`pasteriser-bot/`) is fine but
keeping it together until the bot is non-trivial reduces friction.

---

## What Changed, What Didn't

This table tracks cumulative impact across all phases (0 through 5):

| Layer | Final state | Trajectory |
|-------|-------------|------------|
| **Domain model** (`paste.ts`) | `Paste` + `PasteId` + `ExpirationPolicy` value objects. Added `userId?: string` field in Phase 4.4 for `auth.users(id)` linkage. | Untouched in Phases 0-4.3; one field added in 4.4. |
| **Repository interface** | 9 methods: `save`, `findById`, `view`, `delete`, `findRecentPublic`, `searchPublic`, `getPublicStats`, `resolveSlug`, `saveSlug`. | Was 6 in Phase 0; +1 (`view`) in 4.1, +1 (`searchPublic`) in 4.2, +1 (`getPublicStats`) in 4.5. |
| **Application commands/queries** | `CreatePasteCommand.execute(params, opts: { userId? })`, `GetPasteQuery`, `GetRecentPastesQuery`, `SearchPastesQuery`, `GetPasteStatsQuery`, `DeletePasteCommand`. | `GetPasteQuery.execute()` collapsed to a 3-line wrapper in 4.1 since orchestration moved to the repo. |
| **Factory** (`pasteFactory.ts`) | Round-trips `userId`. | Phase 4.4. |
| **Infrastructure/storage** | `SupabasePasteRepository` only. `KVPasteRepository` + `DualWriteRepository` deleted in Phase 5. | Was KV + Supabase + DualWrite in Phases 1-4; consolidated in Phase 5. |
| **Infrastructure/auth** | `AuthService.getUserIdFromRequest()` validates JWTs via `supabase.auth.getUser()`. | Phase 4.4b. |
| **Entry point** (`index.ts`) | DI of all services in Hono context. Routes for paste CRUD, `/api/recent`, `/api/search`, `/api/stats`, `/login`, `/signup`, `/my`. | `STORAGE_BACKEND` branching removed in Phase 5. |
| **Types** (`types.ts`) | `Env`: `ASSETS`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. | `PASTES`/`STORAGE_BACKEND` removed in Phase 5. |
| **Frontend** (Astro/React) | `UserMenu`, `AuthForm`, `MyPastes`, `RecentPastes` (Realtime), `PasteForm` (sends JWT when signed in), `useAuth` hook, supabase client singleton. | Phases 4.3-4.4. |
| **wrangler.jsonc** | No `vars` block. Both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are Wrangler secrets; required pair documented in a JSONC comment at the top of the file. | KV bindings + `STORAGE_BACKEND` var removed in Phase 5. `SUPABASE_URL` promoted from var to secret in 3.4.0. |
| **astro/.env** | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. | Phases 4.3-4.4. |
| **Unit tests** | 172 passing (+ 22 Astro). | 0 baseline → 113 through Phase 1 → 135 through 4.3 → 151 through 4.4 → 109 after Phase 5 → 142 after BFF (+33) → 147 after 4.4d Path C (+5 `handleConfirm`) → 150 after 3.5.0 (+1 duplicate-email, +2 delete-paste regression) → 172 after 3.6.0 (+22 across recovery, magic-link, OAuth handlers). |
| **Live test scripts** | `test:smoke` (52 cases now), `test:race`, `test:realtime`, `test:rls`, `test:all-live`, plus each one wrapped with `:tail` (e.g. `test:smoke:tail`) via `scripts/with-wrangler-tail.ts`. | Phases 3.5-4.4. Tail wrappers added in 3.4.0. Smoke +17 auth cases in 3.6.0. |
| **Migrations** | 14 files. | 7 baseline + trigger fix (3.5) + `view_paste()` (4.1) + FTS (4.2) + Realtime (4.3) + authenticated RLS (4.4a) + `paste_stats()` (4.5) + title-nullable (3.4.0 bug fix). |
| **Config IaC** | `supabase/config.toml` + `supabase/templates/*.html`. Push via `supabase config push`. Secrets via `env(VAR)` from `.env`. | New in 3.6.0. Reading live state still needs the Management API (no `config pull`). |

---

## Supabase Features Exercised

### Used

| Feature | How it's used | Phase |
|---|---|---|
| **Postgres** | Paste storage, FTS, aggregations, PL/pgSQL functions, row locks, jsonb | 0-4 |
| **RLS** | 1 anon policy + 5 authenticated policies on `pastes`; 1 anon on `slugs`; 2 on `realtime.messages` | 0, 4.4a |
| **Auth: email + password** | Signup, login, session refresh, server-side email confirmation (Path C) | 4.4, 4.4d |
| **Auth: password recovery** | `resetPasswordForEmail` → `/auth/confirm?type=recovery&next=/auth/reset-password` → `updateUser({password})` | 4.4e (3.6.0) |
| **Auth: magic link** | `signInWithOtp({ shouldCreateUser: false })` — re-entry path; not new signups | 4.4e (3.6.0) |
| **Auth: OAuth (GitHub)** | Manual PKCE in Worker via capture-storage; supabase-js `signInWithOAuth` + `exchangeCodeForSession` server-side | 4.4e (3.6.0) |
| **Identity linking** | Default GoTrue auto-linking on verified-email match — same `user_id`, two rows in `auth.identities` (`provider=email` + `provider=github`). `security_manual_linking_enabled` left off. | 4.4e (3.6.0) |
| **Custom SMTP** | Resend (`smtp.resend.com:465`, sender `noreply@erfi.io`, `rate_limit_email_sent` 30/hr) | 3.5.0 |
| **Custom email templates** | 5 templates (confirmation/recovery/magic_link/invite/email_change) — hardcoded `type=` per template; 2 notification templates (linked/unlinked) | 3.4.0 + 3.6.0 |
| **Realtime** | `AFTER INSERT` trigger → `realtime.send()` → private channel `recent:public`; RLS on `realtime.messages` scopes subscribers | 4.3 |
| **pg_cron** | `cleanup-expired-pastes` every 5min, `cleanup-expired-slugs` daily 03:00 | 0 |
| **PL/pgSQL functions** | `view_paste()` (FOR UPDATE row lock for burn-after-reading), `broadcast_public_paste_insert()` (trigger fn), `paste_stats()` (jsonb aggregation). All `SECURITY DEFINER` + `SET search_path = ''` | 4.1, 4.3, 4.5 |
| **Aggregations** | `paste_stats()` SQL function returning jsonb `{totalPublic, byLanguage, byHour, encryption, generatedAt}`. Edge-cached + SWR via Worker. | 4.5 |
| **supabase-js** | Server-side from Worker (`service_role`); via custom storage adapter for PKCE; never browser-direct (BFF). | 1-4 |
| **Supabase Management API** | All auth config patches: `site_url`, `uri_allow_list`, SMTP, OAuth providers, rate limits, email templates. Direct DB queries via `/v1/projects/{ref}/database/query`. | 4.4d onward |
| **Supabase CLI** | `supabase db push --linked` (apply migrations); `supabase config push --yes` (apply config.toml); `supabase init` (scaffold) | 0+; IaC since 3.6.0 |
| **Custom Domain** | `paste.erfi.io` via Cloudflare custom_domain binding — different scope to Supabase Custom Domains (paid; we don't use that one) | 3.5.0 |

### Considered but not used (with reason)

| Feature | Why not |
|---|---|
| **Storage** | Paste content fits in Postgres `text` column (25 MiB acceptable per row). No binary blobs. |
| **Edge Functions** | Cloudflare Worker is the compute layer. Adding a Supabase Edge Function would mean two compute environments to deploy. |
| **Anonymous sign-ins** | App design treats anonymous use as session-less + delete-token-gated, not as throwaway auth.users rows. `external_anonymous_users_enabled = false`. |
| **MFA (TOTP/WebAuthn/phone)** | Single-user prep project. No multi-factor surface yet. Config has it disabled. |
| **Manual identity linking (`linkIdentity()`)** | Auto-linking on verified-email match covers Pasteriser's case (same email across email/password + GitHub). Manual flow is for cross-email merging, which isn't a user journey here. `security_manual_linking_enabled = false`. |
| **pg_graphql** | Worker speaks REST/RPC to supabase-js. No GraphQL clients to feed. |
| **pgvector** | No semantic search workload. FTS via tsvector + GIN is enough for "find a paste by title/language." |
| **pg_net** | Webhook fan-out isn't part of the design. The Realtime broadcast trigger is the live-update mechanism. |
| **Foreign Data Wrappers** | No external data sources to stitch in. |
| **Vault (encrypted secrets)** | Secrets live in Wrangler (for Worker), `.env` (for scripts/CLI), and Supabase's own secret fields (SMTP password). Vault would add a layer without a clear win. |
| **Auth Hooks (`before_user_created`, `custom_access_token`)** | Default JWT claims are sufficient. No custom signup gating beyond Worker rate limits (Phase 4.7 TBD). |
| **Database Webhooks** | Realtime broadcast trigger covers the "react to row changes" need. Webhooks would be useful if we needed delivery to external HTTP endpoints, which we don't. |
| **Supabase Custom Domains** (paid feature, vs. our Cloudflare custom domain) | $10/mo addon to mask `<ref>.supabase.co` in OAuth redirect URIs. Skipped for prep. Documented honestly in `~/supabase/postgres-learnings.md` — see "Vanity OAuth URLs". |
| **SAML / SSO** | Single-user. No enterprise IdP integration. |
| **Web3 / Solana sign-in** | Not in scope. |

---

## Risks and Tradeoffs

| Risk                                                                                                                    | Mitigation                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latency**: KV reads from edge cache are fast (~1ms hot, ~50-200ms cold). Supabase is centralized (~50-200ms from EU). | Choose Frankfurt region (matches your CF setup). For read-heavy paths, cache responses at the edge with CF Cache API. Most pastes are read-once (burn-after-reading, view limits), so cache hit rate is naturally low anyway. |
| **25 MiB content limit**: Postgres `text` can store it, but large payloads mean bigger row sizes.                       | E2E encrypted content is already base64-encoded (33% larger). Consider Supabase Storage for pastes > 1 MiB, with only metadata in Postgres.                                                                                   |
| **E2E encryption**: Server never sees plaintext. Supabase sees the same ciphertext KV currently stores.                 | No change to encryption model. Content is opaque to both KV and Postgres.                                                                                                                                                     |
| **Burn-after-reading atomicity**: KV has documented race condition.                                                     | Postgres `FOR UPDATE` row lock in `view_paste()` function fixes this completely. Net improvement.                                                                                                                             |
| **Cost**: KV is included in Workers plan. Supabase Pro is $25/mo.                                                       | This is a prep project. Free tier (500MB, 50K MAUs) is sufficient for a pastebin.                                                                                                                                             |
