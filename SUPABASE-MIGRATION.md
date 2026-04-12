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
    created_at       TIMESTAMPTZ DEFAULT now(),
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

-- Auto-update updated_at on content/title changes only
-- (read_count increments don't fire this)
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
		supabaseKey: string, // service_role key (Worker is trusted backend)
		private readonly logger: Logger,
	) {
		this.client = createClient(supabaseUrl, supabaseKey);
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
			encryption_version: data.version,
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

		if (error || !data) return null;

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
			version: row.encryption_version,
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
- Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as Wrangler secrets
- Add `@supabase/supabase-js` to package.json
- Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the `Env` interface in `types.ts`

### Phase 1: Dual-Write (Day 2-3)

- Create `SupabasePasteRepository` implementing `PasteRepository`
- Create a `DualWriteRepository` wrapper that writes to both KV and Supabase, reads from KV
- Feature-flag via env var: `STORAGE_BACKEND: 'kv' | 'supabase' | 'dual'`
- Update `index.ts` to instantiate the correct repository based on the flag
- Deploy with `STORAGE_BACKEND=dual` -- new pastes go to both, reads still from KV
- Verify data is landing in Supabase correctly via the dashboard

### Phase 2: Read from Supabase (Day 4-5)

- Switch `DualWriteRepository` to read from Supabase, still write to both
- Replace `findRecentPublic` with the Supabase implementation (single query vs KV pagination)
- Replace `getPasteQuery.execute()` to use the `view_paste()` Postgres function for atomic burn/view-limit
- Test: burn-after-reading with concurrent requests should now be atomic
- Deploy, monitor for errors

### Phase 3: KV Removal (Day 6-7)

- Switch to `STORAGE_BACKEND=supabase`
- Remove KV writes from the dual-write path
- Keep KV namespace in wrangler.jsonc temporarily (fallback)
- Run a one-time migration script to copy any pastes still only in KV to Supabase
- After validation period, remove KV namespace binding

### Phase 4: New Features (Week 2+)

Now that you have Postgres, build features KV couldn't support:

**Search** (exercises: Postgres full-text search or `ILIKE`)

```sql
-- Add a search endpoint
SELECT id, title, language, created_at
FROM pastes
WHERE visibility = 'public'
  AND (title ILIKE '%query%' OR language = 'python')
ORDER BY created_at DESC
LIMIT 20;
```

**User accounts** (exercises: Supabase Auth + RLS)

- Add Supabase Auth (anonymous sessions -> optional signup)
- Link pastes to `auth.users` via `user_id` column
- "My Pastes" page using RLS (user only sees their own)
- Authenticated users don't need `deleteToken` -- RLS handles it

**Live recent feed** (exercises: Supabase Realtime)

- Subscribe to `INSERT` events on `pastes` table where `visibility = 'public'`
- Recent pastes page updates without polling

**Analytics** (exercises: Postgres aggregation)

```sql
-- Pastes by language
SELECT language, count(*) FROM pastes
WHERE visibility = 'public' GROUP BY language ORDER BY count DESC;

-- Paste creation over time
SELECT date_trunc('hour', created_at) AS hour, count(*)
FROM pastes GROUP BY hour ORDER BY hour DESC LIMIT 48;

-- Encryption adoption
SELECT encryption_version, count(*) FROM pastes GROUP BY encryption_version;
```

**Expiration done right** (exercises: pg_cron)

- Already handled by the `cleanup-expired-pastes` cron job
- KV TTL was the only cleanup mechanism before -- now you have both automatic expiry AND queryable expired-but-not-yet-cleaned data

---

## What Changes, What Doesn't

| Layer                            | Changes?       | Details                                                    |
| -------------------------------- | -------------- | ---------------------------------------------------------- |
| **Domain model** (`paste.ts`)    | No             | Untouched. Same Paste class.                               |
| **Repository interface**         | No             | Same 6 methods.                                            |
| **Application commands/queries** | Minimal        | `getPasteQuery` could use `view_paste()` RPC for atomicity |
| **Factory** (`pasteFactory.ts`)  | No             | Same rehydration logic.                                    |
| **Infrastructure**               | Yes            | New `SupabasePasteRepository` + `DualWriteRepository`      |
| **Entry point** (`index.ts`)     | Yes            | Repository instantiation based on env flag                 |
| **Types** (`types.ts`)           | Yes            | Add Supabase env vars to `Env` interface                   |
| **Frontend** (Astro/React)       | No (Phase 1-3) | Frontend doesn't know about the backend change             |
| **wrangler.jsonc**               | Yes            | Add Supabase secrets                                       |

---

## Supabase Features Exercised

| Feature            | How it's used                                         | Prep value                      |
| ------------------ | ----------------------------------------------------- | ------------------------------- |
| **Postgres**       | Paste storage, search, aggregation, atomic operations | Core skill                      |
| **RLS**            | Public/private visibility, user-scoped "my pastes"    | Most important Supabase feature |
| **Auth**           | Optional user accounts, "my pastes"                   | Phase 4                         |
| **Realtime**       | Live recent paste feed                                | Phase 4                         |
| **pg_cron**        | Expired paste cleanup                                 | Phase 0                         |
| **Edge Functions** | Not needed (Worker is the compute layer)              | N/A                             |
| **Storage**        | Not needed (content is in Postgres `text` column)     | N/A                             |
| **supabase-js**    | From a Cloudflare Worker context (not Next.js)        | Real-world pattern              |

---

## Risks and Tradeoffs

| Risk                                                                                                                    | Mitigation                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Latency**: KV reads from edge cache are fast (~1ms hot, ~50-200ms cold). Supabase is centralized (~50-200ms from EU). | Choose Frankfurt region (matches your CF setup). For read-heavy paths, cache responses at the edge with CF Cache API. Most pastes are read-once (burn-after-reading, view limits), so cache hit rate is naturally low anyway. |
| **25 MiB content limit**: Postgres `text` can store it, but large payloads mean bigger row sizes.                       | E2E encrypted content is already base64-encoded (33% larger). Consider Supabase Storage for pastes > 1 MiB, with only metadata in Postgres.                                                                                   |
| **E2E encryption**: Server never sees plaintext. Supabase sees the same ciphertext KV currently stores.                 | No change to encryption model. Content is opaque to both KV and Postgres.                                                                                                                                                     |
| **Burn-after-reading atomicity**: KV has documented race condition.                                                     | Postgres `FOR UPDATE` row lock in `view_paste()` function fixes this completely. Net improvement.                                                                                                                             |
| **Cost**: KV is included in Workers plan. Supabase Pro is $25/mo.                                                       | This is a prep project. Free tier (500MB, 50K MAUs) is sufficient for a pastebin.                                                                                                                                             |
