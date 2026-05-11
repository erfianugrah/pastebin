# Pasteriser: Supabase Migration Scope

## Current Architecture

```
Browser (Astro + React)
  -> Cloudflare Worker (Hono router)
    -> KV Namespace: PASTES (paste data + recent list + vanity slugs)
```

Single KV namespace. No auth. No database. No analytics persistence.

Live at: https://paste.erfi.dev

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
-- Run in pgpasteriser after creating a paste on paste.erfi.dev
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
  `paste.erfi.dev` and queries Supabase directly. Adds RLS coverage:
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

1. Open `https://paste.erfi.dev/signup`, create an account.
2. After email confirmation (or immediately if disabled in the
   project's auth settings), log in at `/login`.
3. Create a paste with `Private` visibility.
4. Navigate to `/my` — the private paste appears.
5. Sign out, navigate to `/my` — see the sign-in prompt.
6. Other users do NOT see your private paste (verified
   programmatically by `npm run test:rls`).

#### 4.4d: OAuth providers (planned, not yet started)

Email + password is implemented (`AuthForm.tsx`). Next iteration adds
OAuth — GitHub first because it's the most useful for developers and
needs no email-server config. Reference: `~/supabase/acme-corp/src/app/login/page.tsx`
shows the exact `signInWithOAuth` pattern.

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

| Priority | Action | Why first | Effort |
|----------|--------|-----------|--------|
| 1 | **Cloudflare Turnstile** on `/signup` form + Supabase Auth Bot and Abuse Protection. Supabase has native integration (Dashboard → Auth → Bot and Abuse Protection → CAPTCHA secret). | Highest ROI per Reddit + Supabase docs. Eliminates 92% of automated abuse per Sentinel/Discury surveys. | 1-2h |
| 2 | **Cap anonymous paste size** (e.g., 64 KiB anon, 1 MiB authenticated, 25 MiB never). | Storage flooding is the cheapest attack and the most expensive to recover from. | 10 min |
| 3 | **Configure custom SMTP** (Resend / Postmark) before any production email volume. | Inbuilt 4/hour is unusable. Even disabling email confirmation entirely is safer than relying on it. | 30 min + provider account |
| 4 | **Tighten Supabase Auth rate limits** via Management API. Force conservative defaults (10 signups/hour/IP, 30 token refreshes/hour/IP). | Mitigation #2333 says config is buggy but the burst cap helps at scale. | 5 min |
| 5 | **Move signup behind the Worker** — instead of browser calling `supabase.auth.signUp()` direct, browser POSTs to `/api/auth/signup`. Worker validates Turnstile token, checks Cloudflare bot-score, then calls Supabase Auth admin API with `Sb-Forwarded-For` header so per-IP limits work correctly. | Worker rate limit kicks in *before* Supabase Auth gets the request, doubling the gate. | 2-3h |
| 6 | **PostgREST-side per-IP rate limit** for browser-direct paths (`/my` reads, Realtime subscribes). `private.rate_limits` table + `before insert/update/delete` triggers per `supabase/guides/api/securing-your-api.md`. | Defense in depth — Worker rate limit doesn't gate direct DB queries. | 1h |
| 7 | **Cloudflare WAF rules** — block IPs with abusive paste-creation patterns (e.g., > 5 pastes/min, > 100 KiB body size and burst-y). | Stops obvious bots at the edge before they reach the Worker. | 30 min |
| 8 | **Per-account daily quota** tracked in Postgres — `auth.users` daily-bytes column updated by a trigger on `pastes` insert. | Catches the rare case where a single legitimate-looking user fills the DB. | 2h |

**Quick wins to ship today (~half a day for #1-4):** removes the
most realistic abuse vectors. After this, an attacker would need to
solve Turnstile per request, exhaust a custom-SMTP quota that's
typically 10,000+/day, and only be able to fill the DB with ≤ 1 MiB
pastes (and only by signing up first).

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

## Phase 6: Discord bot integration (idea, not scoped)

Concept: a Discord bot that wraps Pasteriser, addressing Discord's
text + image limits:

- **Long messages**: bot intercepts `/paste <code>` or messages above
  a threshold (Discord limit is 2000 chars for free, 4000 for Nitro;
  4 MiB for image attachments) and uploads them as Pasteriser pastes,
  returning a URL.
- **Server-scoped**: each Discord guild gets a derived `user_id` (or
  a Supabase Auth identity), so pastes from a guild are visible only
  to members of that guild. Implementable as a `guild_id` column on
  pastes + an RLS policy that joins on a `guild_members` table the
  bot maintains.
- **Auto-encryption**: bot generates the E2EE key client-side (in the
  bot's runtime), posts the ciphertext + key fragment, hands the
  fragment URL back to the channel. Discord users see a normal URL;
  the key never enters the database.
- **Self-hosted deployment**: viable on Unraid as a Docker container.

### Viability of running Deno + Discord.js on Unraid

**Why Deno specifically?** Supabase Edge Functions are Deno-based;
running the same runtime locally means the bot can share code with
future Edge Functions (if needed) and uses modern web APIs (fetch,
Web Crypto) without polyfills. Discord.py / discord.js / Discord
gateway libraries all work in Deno via `npm:` specifiers.

**Containerisation:** Standard Deno container is `denoland/deno:latest`
(~50 MiB Alpine image). Pasteriser's bot would be:

```dockerfile
FROM denoland/deno:alpine-2
WORKDIR /app
COPY . .
RUN deno cache main.ts
CMD ["deno", "run", "--allow-net", "--allow-env", "main.ts"]
```

Unraid template wires up:
- `DISCORD_TOKEN` (Wrangler-style secret)
- `PASTERISER_API_URL` (paste.erfi.dev)
- `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (for direct DB reads
  in the bot, if needed)
- Persistent volume for SQLite if the bot tracks its own state
  (guild → user_id mapping, etc.)

**Resource footprint:** Deno + Discord gateway is small —
~80-150 MiB RAM in steady state for a single bot connection.

**Networking:** Bot is a Discord WebSocket client, no inbound ports
required. Pasteriser API calls go out via HTTPS. No reverse-proxy
config needed.

**Trade-offs:**

| Aspect | Verdict |
|--------|---------|
| Latency | Low — Unraid → Discord WS is fast; bot → Pasteriser is the same CF edge as anyone else |
| Reliability | Acceptable for prep/dev. Discord rate-limits and the bot's uptime depend on Unraid's reliability; for "real" deployment migrate to Fly.io or a Workers cron+queue model. |
| Auth model | Bot acts as a service account. For server-scoped RLS, add a `guild_id` column + policies. Alternative: bot creates one Supabase Auth user per Discord user via the admin API, and impersonates them with their JWT. |
| Cost | $0 — Unraid is already running. Discord bot tier is free. |
| Maintenance | Auto-rebuild on push via Watchtower or a CI hook (existing Composer setup handles this). |

**MVP scope:** read-only command, `/paste <url>` and `/paste-long
<text>`. No server-scoped encryption initially; just upload as
anonymous Pasteriser pastes. Phase 2 of the bot work: add per-guild
encryption + RLS scoping.

This phase is **not committed** to the migration plan — captured here
so the design notes don't get lost.

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
| **wrangler.jsonc** | `SUPABASE_URL` var only. `SUPABASE_SECRET_KEY` as Wrangler secret. | KV bindings + `STORAGE_BACKEND` var removed in Phase 5. |
| **astro/.env** | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. | Phases 4.3-4.4. |
| **Unit tests** | 109 passing. | 0 baseline → 113 through Phase 1 → 135 through 4.3 → 151 through 4.4 → 109 after Phase 5 (-28 KV/dual tests, -17 integration tests, +5 stats tests). |
| **Live test scripts** | `test:smoke`, `test:race`, `test:realtime`, `test:rls`, `test:all-live`. | Phases 3.5-4.4. |
| **Migrations** | 13 files. | 7 baseline + trigger fix (3.5) + `view_paste()` (4.1) + FTS (4.2) + Realtime (4.3) + authenticated RLS (4.4a) + `paste_stats()` (4.5). |

---

## Supabase Features Exercised

| Feature            | How it's used                                         | Status |
| ------------------ | ----------------------------------------------------- | ------ |
| **Postgres**       | Paste storage, FTS via tsvector + GIN, aggregations, PL/pgSQL functions with row locks | ✓ Phases 0-4 |
| **RLS**            | Anon: public pastes / non-expired slugs. Authenticated: 5 own-row policies (SELECT public, SELECT/INSERT/UPDATE/DELETE own). Realtime: scoped to `recent:public` topic | ✓ Phases 0, 4.4a |
| **Auth (email+pw)** | Signup, login, session refresh, `auth.users(id)` FK from `pastes.user_id`. `/login`, `/signup`, `/my` pages with React islands. | ✓ Phase 4.4 |
| **Auth (OAuth)**   | GitHub provider — pattern documented (acme-corp reference), not yet implemented | ⏳ 4.4d |
| **Realtime**       | Live recent paste feed. `AFTER INSERT` trigger calls `realtime.send()` to private channel `recent:public`. RLS on `realtime.messages` enforces topic scoping. | ✓ Phase 4.3 |
| **pg_cron**        | Expired paste cleanup every 5min, expired slug cleanup daily at 03:00 | ✓ Phase 0 |
| **pg_proc / PL/pgSQL** | `view_paste()` RPC with `SELECT ... FOR UPDATE` for atomic burn-after-reading. `broadcast_public_paste_insert()` trigger function. Both `SECURITY DEFINER` + `SET search_path = ''`. | ✓ Phases 4.1, 4.3 |
| **Storage**        | Not needed (paste content in Postgres `text` column; 25 MiB limit acceptable) | N/A |
| **Edge Functions** | Not needed (Cloudflare Worker is the compute layer) | N/A |
| **supabase-js**    | From a Cloudflare Worker (`service_role`) and from the browser (`anon` + user JWT). Two-client testing pattern matches official docs. | ✓ Phases 1-4 |
| **Aggregations**   | `paste_stats()` SQL function with `jsonb_build_object` returning total/language/hour/encryption/generatedAt. Exposed via `GET /api/stats`. | ✓ Phase 4.5 |

---

## Risks and Tradeoffs

| Risk                                                                                                                    | Mitigation                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latency**: KV reads from edge cache are fast (~1ms hot, ~50-200ms cold). Supabase is centralized (~50-200ms from EU). | Choose Frankfurt region (matches your CF setup). For read-heavy paths, cache responses at the edge with CF Cache API. Most pastes are read-once (burn-after-reading, view limits), so cache hit rate is naturally low anyway. |
| **25 MiB content limit**: Postgres `text` can store it, but large payloads mean bigger row sizes.                       | E2E encrypted content is already base64-encoded (33% larger). Consider Supabase Storage for pastes > 1 MiB, with only metadata in Postgres.                                                                                   |
| **E2E encryption**: Server never sees plaintext. Supabase sees the same ciphertext KV currently stores.                 | No change to encryption model. Content is opaque to both KV and Postgres.                                                                                                                                                     |
| **Burn-after-reading atomicity**: KV has documented race condition.                                                     | Postgres `FOR UPDATE` row lock in `view_paste()` function fixes this completely. Net improvement.                                                                                                                             |
| **Cost**: KV is included in Workers plan. Supabase Pro is $25/mo.                                                       | This is a prep project. Free tier (500MB, 50K MAUs) is sufficient for a pastebin.                                                                                                                                             |
