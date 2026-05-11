# Changelog

## [3.5.0] - 2026-05-11

### Auth UX polish (post-domain-change session)

- **`handleSignup`** — detect Supabase's anti-enumeration response (success-shaped payload with `user.identities = []` when the email is already registered) and return HTTP 409 `email_taken` instead of the misleading "check your email" path that left users staring at an email that was never sent.
- **`handleLogin`** — distinguish `email_not_confirmed` (HTTP 403 with actionable message) from `invalid_credentials` (HTTP 401). Supabase only returns `email_not_confirmed` when the password is correct, so anti-enumeration is preserved for wrong-password guesses.
- **`POST /api/auth/resend-confirmation`** — new endpoint. Calls `supabase.auth.resend({ type: 'signup', email })`. Always returns 200 (Supabase's own rate-limit gates abuse).
- **`AuthForm.tsx`** — replace dangling "check your email" banner under the empty form with a dedicated success panel ("Check your email at &lt;addr&gt;" + "Didn't get it? Resend" + "Wrong email? Try again" buttons). On login failure with `email_not_confirmed`, render an inline "Resend confirmation email" link.
- **`MyPastes.tsx`** — kill leaked developer copy ("Listed via the Worker; Supabase access goes through service_role + an explicit `user_id` filter"). Replace with a small "{n} pastes" line + "New paste" CTA in the same row.
- **`my.astro`** — subtitle "Pastes you create while signed in." under the H1.

### Email template fix (was breaking confirm clicks)

- `mailer_templates_confirmation_content` was using `{{ .EmailActionType }}`, which doesn't exist on the confirmation email context. The variable rendered as empty string → link had `&type=&` → `/auth/confirm` correctly rejected as `invalid_type`. Hardcode `type=signup` (the template is only ever for signup).
- Apply the same fix preemptively to recovery (`type=recovery`), magic_link (`type=magiclink`), invite (`type=invite`), email_change (`type=email_change`). All four were carrying the same footgun for future flows. Patched via Management API.

### Test-cleanup bug fixes

- **`handleDeletePaste`** had a method-discrimination bug: read JSON body only when `request.method === 'DELETE'`. Router accepts both DELETE and POST on `/pastes/:id/delete`, so POST + JSON body silently fell through to query-param-only auth and always returned 403. `verify-realtime.ts` cleanup uses POST + body and was therefore leaking 2 pastes per run (1 public + 1 private). 47 leaked pastes wiped from production.
- 2 new unit tests cover both methods reading body identically.
- `verify-realtime.ts` was sending `{ deleteToken }` instead of `{ token }` in the body — handler reads `body.token`. Fixed + surfaced via `console.warn` instead of silent `.catch(() => {})`.
- `smoke-test.ts` search tests created 2 pastes per run (a public "searchable" one and a private "secret" one) without `createdIds.push()` — silent leak. Both added to the cleanup list. Same script's `cleanup()` was also silencing all errors; switched to warn-on-failure.
- Production verification: 1 user paste remains, 0 test artifacts, after running smoke + realtime back-to-back with new cleanup.

### Domain change: `paste.erfi.dev` → `paste.erfi.io`

- **`wrangler.jsonc`**: routes pattern updated for both top-level and production env. Cloudflare auto-provisioned DNS + SSL via the existing `erfi.io` zone on deploy.
- **18 files** in-place updated: 4 Worker scripts, 4 live test scripts (`smoke`, `race`, `realtime`, `rls`), Playwright config, Astro pages/components/tests, Astro `astro.config.mjs`, `og-image.svg`, JSDoc comments in `authHandlers.ts`, and all 4 docs (`README`, `AGENTS`, `CHANGELOG`, `SUPABASE-MIGRATION`). Zero remaining `paste.erfi.dev` references.
- **Astro client bundle** rebuilt with `PUBLIC_API_URL=https://paste.erfi.io`.
- **Supabase Auth config** updated via Management API:
  - `site_url`: `https://paste.erfi.io`
  - `uri_allow_list`: `https://paste.erfi.io/auth/confirm,https://paste.erfi.io/my,https://paste.erfi.io/`
- **Old `paste.erfi.dev` removed** by Wrangler on deploy (custom_domain entries are exclusive).

### Auth — custom SMTP via Resend

- **Supabase SMTP configured** via the same `PATCH /v1/projects/{ref}/config/auth` endpoint:
  - `smtp_host`: `smtp.resend.com`
  - `smtp_port`: `465`
  - `smtp_user`: `resend`
  - `smtp_pass`: Resend API key (RFC-9051 SMTP AUTH; the key is the SASL password)
  - `smtp_admin_email`: `noreply@erfi.io` (uses the existing verified `erfi.io` Resend domain)
  - `smtp_sender_name`: `Pasteriser`
  - `smtp_max_frequency`: `1` (one email per second per address)
- **Auth email rate limit bumped** from `2` → `30` per hour (was the bottleneck causing "email rate limit exceeded" on repeated signups under the default inbuilt SMTP).
- End-to-end verified: signup via `/api/auth/signup` returns `needsConfirm: true` and Resend's `/emails` API logs the corresponding `Confirm Your Signup` send with `status=sent`.

### Tests

- 150 unit tests (was 147 — +1 duplicate-email signup, +2 delete-paste method-body coverage).
- All 4 live suites re-run green against `paste.erfi.io`: smoke 35/35, RLS 13/13, Realtime 13/13 (standalone), race race-free. Playwright 10/10.
- DB state after full live cycle: 1 paste (the real one), 0 leaked test artifacts, 1 auth user.

### Breaking changes

- **DNS**: `paste.erfi.dev` no longer resolves to the Worker. Old bookmarks/links are broken. If `paste.erfi.dev` needs to stay alive, add it back as a custom_domain route alongside `paste.erfi.io`.

---

## [3.4.0] - 2026-05-11

### Auth — server-side email confirmation (Path C)

- **`GET /auth/confirm` route + `AuthHandlers.handleConfirm()`** — Worker is now the landing page for Supabase Auth confirmation emails (signup, recovery, magic-link, email change). Reads `?token_hash=...&type=...&next=...`, calls `supabase.auth.verifyOtp({ token_hash, type })` server-side, sets HttpOnly `sb-access-token` + `sb-refresh-token` cookies, then 302s to `next`. Same-origin-only redirect target (rejects `//evil.com` and external hosts; falls back to `/`).
- **Email template + Site URL** updated via the Supabase Management API (`PATCH /v1/projects/{ref}/config/auth`) — no Dashboard click-ops:
  - `site_url`: `http://localhost:3000` → `https://paste.erfi.io`
  - `uri_allow_list`: `https://paste.erfi.io/auth/confirm,https://paste.erfi.io/my,https://paste.erfi.io/`
  - `mailer_templates_confirmation_content`: rewritten to use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .EmailActionType }}&next=/my`
- End-to-end verified against production: admin `generate_link` → real `hashed_token` → `/auth/confirm` → 302 to `/my` with a valid JWT cookie (sub matches the user, `email_verified=true`, `role=authenticated`).

### Database

- **Migration `20260511180117_title_nullable.sql`** — `ALTER TABLE pastes ALTER COLUMN title DROP NOT NULL`. The original schema marked `title NOT NULL` but the domain model + Zod schema treat title as optional; POSTing without title hit `null value in column "title" violates not-null constraint` (Postgres code 23502) and returned 500. Smoke tests bypassed the bug because they always send a title; Playwright caught it.

### Operations

- **`SUPABASE_URL` promoted** from a Wrangler `var` (visible in committed `wrangler.jsonc`) to a Wrangler `secret`. The project URL is now treated as a secret like `SUPABASE_SECRET_KEY`. `wrangler.jsonc` has no `vars` block; both required secrets are listed only in a JSONC comment at the top of the file.
- **`scripts/with-wrangler-tail.ts`** — wraps any live test script with a concurrent `wrangler tail --env production` so Worker logs (errors, exceptions, `console.log`) stream interleaved with the test output, prefixed `[tail]` in dim gray. Waits 3s for tail to attach before launching the test. Forwards SIGINT to both processes. Six new npm scripts: `test:smoke:tail`, `test:race:tail`, `test:realtime:tail`, `test:rls:tail`, `test:all-live:tail`, `test:e2e:tail`.

### Tests

- 147 unit tests (was 142): 5 new `handleConfirm` cases covering missing token, invalid type, success path with cookies + redirect, open-redirect defense, and `verifyOtp` error surface.
- Playwright 10/10 (was 7/10 — three failures all downstream of the `POST /pastes` 500).

### Breaking changes

None.

---

## [3.3.0] - 2026-05-11

### Database

- **`paste_stats()` function** (migration `20260511150017_add_paste_stats.sql`): `LANGUAGE sql STABLE`, `SECURITY DEFINER`, `SET search_path = ''`. Returns a jsonb summary of non-expired public pastes: `totalPublic`, `byLanguage` (top 20), `byHour` (last 48h), `encryption` (version → count), `generatedAt`. Exposed via `GET /api/stats`.

### Application

- New `GetPasteStatsQuery` and `PasteRepository.getPublicStats()` method.
- `GET /api/stats` endpoint (edge-cached 5min + SWR 15min). Returns 200 with the jsonb payload or 503 when the repo can't compute aggregates.

### Phase 5: KV removal

- **Database wipe** — Deleted all 81 paste rows (clean slate for future testing). Slugs cascade automatically via FK.
- **Cloudflare KV** — Deleted the `PASTES` namespace from the account via `wrangler kv namespace delete`.
- **`wrangler.jsonc`** — Removed `kv_namespaces[]` blocks (top-level and production env) and the `STORAGE_BACKEND` var.
- **`src/types.ts`** — Removed `PASTES: KVNamespace` and `STORAGE_BACKEND` from the `Env` interface.
- **`src/index.ts`** — Removed `KVPasteRepository` and `DualWriteRepository` imports + instantiation. The Worker now instantiates `SupabasePasteRepository` directly.
- **Files deleted**:
  - `src/infrastructure/storage/kvPasteRepository.ts` (213 lines)
  - `src/infrastructure/storage/dualWriteRepository.ts` (96 lines)
  - Their test files
  - `src/tests/integration/routes.test.ts` (tightly coupled to MockKV; every scenario it covered is now covered by the live smoke + RLS + race tests)

### Tests

- 109 unit tests (was 152: removed 28 KV/Dual tests, removed 17 integration tests, added 5 stats tests).
- `test:all-live` orchestrator (4 suites, deterministic with cooldowns).

### Other cleanups

- `verify-realtime.ts` cleanup wrapped in try/finally so paste deletion runs even when assertions fail.
- `handlers.ts`: `authService` constructor arg changed from null-default to optional.

### Breaking changes

None for end users. `STORAGE_BACKEND=kv` is no longer a supported value (it was never set in production after Phase 3).

---

## [3.2.0] - 2026-05-11

### Auth (Phase 4.4)

- **5 RLS policies** on `public.pastes` for the `authenticated` role: view public, view own, create own, update own (USING + WITH CHECK), delete own. All use `(SELECT auth.uid())` for initPlan caching and `TO authenticated` for role gating. Migration `20260511140659_authenticated_rls_policies.sql`.
- **`AuthService`** in the Worker validates `Authorization: Bearer <jwt>` via `supabase.auth.getUser()`. Extracts `user_id` from the verified token.
- **`Paste` domain model** gains a `userId` field with full round-trip support (factory, repository save/findById, toJSON(includeSecrets)).
- **`CreatePasteCommand`** accepts `opts.userId` — sourced only from the verified JWT, never from the request body (impersonation guard).
- **`SupabasePasteRepository`** persists `user_id` on save (null for anonymous), hydrates on findById.
- **Frontend**: `/login`, `/signup`, `/my` pages. React islands: `UserMenu` (header), `AuthForm` (login/signup), `MyPastes` (queries Supabase directly via RLS — no Worker endpoint needed). `useAuth` hook subscribes to `onAuthStateChange`. `PasteForm` attaches JWT to `/pastes` requests when signed in.
- **`scripts/verify-rls.ts`** (npm run test:rls): 13 RLS checks against production using 2 real Supabase Auth users created via the admin API. Asserts JWT persistence, RLS SELECT own + public, cross-user blocking, RLS DELETE own + cross-user-block, RLS WITH CHECK impersonation rejection.
- **`scripts/run-all-live-tests.ts`** (npm run test:all-live): orchestrates all 4 live test suites with cooldowns to avoid rate-limit-induced flakiness.

### Tests

- 151 unit tests (+16 since 3.1.0): 7 for AuthService, 2 for command userId, 4 for repo user_id, 3 for handler JWT flow.

### Breaking changes

None for end users. Anonymous paste creation still works (user_id = NULL). The `Authorization: Bearer` header is optional.

---

## [3.1.0] - 2026-05-11

### Database

- **Trigger fix**: `set_updated_at` now includes a `WHEN (OLD.x IS DISTINCT FROM NEW.x)` clause. Previous trigger fired on every `upsert()` even when content/title were unchanged (the `UPDATE OF` clause fires on column presence, not value change). Migration `20260511124104_fix_updated_at_trigger.sql`.
- **`view_paste(uuid)` RPC** (migration `20260511130427_add_view_paste_rpc.sql`): atomic read + read-count increment + burn-after-reading + view-limit enforcement via `SELECT ... FOR UPDATE` row lock. Fixes the documented concurrency race in burn-after-reading. `SECURITY DEFINER` + `SET search_path = ''` hardening; `EXECUTE` granted only to `service_role`.
- **Full-text search** (migration `20260511131541_add_paste_search.sql`): `search_vector tsvector` generated column (`to_tsvector('english', title || ' ' || language)`) backed by a GIN index. Exposed via `GET /api/search`.
- **Realtime broadcast** (migration `20260511132703_realtime_public_paste_feed.sql`): `AFTER INSERT` trigger on `pastes` filters `visibility = 'public'` and emits a curated payload via `realtime.send()` to private channel `recent:public`. RLS on `realtime.messages` restricts `anon`/`authenticated` to the exact topic.

### Application

- **`PasteRepository`** now has 8 methods (`save`, `findById`, `view`, `delete`, `findRecentPublic`, `searchPublic`, `resolveSlug`, `saveSlug`).
- **`GetPasteQuery.execute()`** collapsed from 50 lines of orchestration to a 3-line wrapper around `repository.view()` — orchestration now lives in the repo so atomicity guarantees are per-backend (Supabase: row-locked RPC, KV: documented best-effort race).
- **`SupabasePasteRepository` constructor** passes server-side `auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }` to `createClient()`. Matches Supabase-recommended pattern for non-browser contexts.
- **New endpoints**: `GET /api/search` (websearch FTS), `GET /api/recent` (existing, unchanged shape).

### Frontend

- **`RecentPastes.tsx`** subscribes to Realtime topic `recent:public` and prepends new pastes to the list. `LiveIndicator` shows connection state. Graceful fallback to polling when `PUBLIC_SUPABASE_*` env vars are missing.
- **`astro/.env.example`** added with `PUBLIC_API_URL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

### Testing

- **135 unit tests** (was 113). +11 new tests for `view()` orchestration, +11 for search.
- **`npm run test:smoke`**: 25 live API + DB tests against production.
- **`npm run test:race`**: 5 fresh burn-after-reading pastes × 20 concurrent views = 100 requests. Asserts exactly 5 wins (one per paste). Race-free.
- **`npm run test:realtime`**: 13 checks across 3 groups — end-to-end pipeline, key×channel compatibility matrix, RLS denials.

### Documentation

- `SUPABASE-MIGRATION.md`: Phase 3.5 (audit fixes) + Phase 4.1 (view_paste) + 4.2 (search) + 4.3 (realtime) sections.
- `postgres-learnings.md`: PL/pgSQL function patterns, `FOR UPDATE` row locks, full FTS section (tsvector / tsquery / GIN / websearch_to_tsquery), full Realtime section with empirically-verified compatibility matrix.
- `AGENTS.md`: 11 migrations, 8-method interface, all new patterns documented.

### Breaking changes

None for end users. The Worker API surface is additive (new endpoints, no removed/changed ones).

---

## [3.0.0] - 2026-05-11

### Infrastructure

#### Storage backend migrated from Cloudflare KV to Supabase Postgres

- **Database**: Supabase project `dewddkcmwrzbpynylyhg` (Frankfurt, `eu-central-1`)
- **Schema**: 7 migrations covering `pastes` + `slugs` tables, trigger for `updated_at`, 3 indexes, RLS policies, pg_cron cleanup jobs
- **Implementation**:
  - New `SupabasePasteRepository` implementing `PasteRepository`
  - New `DualWriteRepository` shadow-write wrapper (used in Phase 1 of migration)
  - Feature-flagged via `STORAGE_BACKEND` env var (`kv` | `dual` | `supabase`)
  - `pasteRepository` added to Hono context for slug handler reuse
- **Tests**: 25 new tests (14 for Supabase repo, 11 for dual-write), 113 total passing
- **Rollback**: Change `STORAGE_BACKEND` to `kv` in `wrangler.jsonc` and redeploy. KV namespace retained in bindings.
- **Documentation**: Full migration journey in `SUPABASE-MIGRATION.md`

### Frontend

- **Astro**: upgraded `6.0.2 → 6.3.1`, `@astrojs/react 5.0.0 → 5.0.4`

### Why

- KV is key-value only — no search, no filtering, no aggregation, no user accounts
- Postgres enables: search by title/language, "my pastes" page (Phase 4), live recent feed via Realtime (Phase 4), proper analytics
- Fixes documented concurrency bug in burn-after-reading (Phase 4 via `view_paste()` RPC with `FOR UPDATE`)

### Breaking changes

None for end users. The Worker API is unchanged. Storage backend swap is invisible to clients.

---

## [2.0.0] - 2026-02-27

### Security

#### Paste Deletion Authorization
- **Delete Token**: Pastes now include a `deleteToken` (UUID) generated at creation time
- **Authorized Deletion**: `DELETE /pastes/:id/delete` requires the token via `?token=` query param or JSON body
- **API Change**: `POST /pastes` response now includes `deleteToken` field
- **Breaking**: Existing pastes without a `deleteToken` can still be deleted (backward compatible), but new pastes require the token
- **Locations**: `src/domain/models/paste.ts`, `src/application/commands/createPasteCommand.ts`, `src/application/commands/deletePasteCommand.ts`

#### Webhook Secret Redaction
- **Secrets Hidden**: `GET /api/webhooks` and `GET /api/webhooks/:id` no longer expose the `secret` field
- **Location**: `src/infrastructure/webhooks/webhookService.ts`

#### SSRF Prevention for Webhooks
- **URL Validation**: Webhook registration and updates now validate URLs
- **Blocked**: Private IPs (10.x, 172.16-31.x, 192.168.x), loopback (127.0.0.1, ::1, localhost), metadata endpoints (169.254.169.254), non-HTTPS URLs, `.local`/`.internal` hostnames
- **Location**: `src/infrastructure/webhooks/webhookService.ts`

#### Timing-Safe Auth Hardened
- **Length-Oracle Fix**: Admin auth now hashes both inputs with SHA-256 before constant-time XOR comparison, eliminating the early return on length mismatch
- **Async**: `validateAdminAuth` is now `async` to support `crypto.subtle.digest`
- **Location**: `src/infrastructure/auth/adminAuth.ts`

#### CSP Tightened
- **Removed `unsafe-eval`**: `script-src` now restricted to `'self'` only
- **Web Workers**: Continue to work via existing `worker-src 'self' blob:` directive
- **Location**: `src/interfaces/api/middleware.ts`

### Fixed

#### Critical: Burn-After-Reading Broken on Create
- **Root Cause**: `handleCreatePaste` called `getPasteQuery.execute()` to fetch the paste for webhooks, which incremented the read count and triggered burn-after-reading deletion
- **Fix**: Added `GetPasteQuery.findById()` — a read-only method that does not increment read count or trigger side effects
- **Locations**: `src/application/queries/getPasteQuery.ts`, `src/interfaces/api/handlers.ts`

#### Critical: View Limit Deletion Unreliable
- **Root Cause**: Used `setTimeout` to schedule deletion after view limit reached, but Cloudflare Workers may terminate the isolate before the timeout fires
- **Fix**: Deletion now happens synchronously before returning the response
- **Location**: `src/application/queries/getPasteQuery.ts`

#### AppError Constructor Arguments Swapped
- **Root Cause**: All `AppError` calls in `webhookService.ts` passed `(message, statusCodeString)` instead of `(code, message, statusCode)`
- **Fix**: Corrected all 7 call sites to use `(code, message, numericStatus)` format
- **Location**: `src/infrastructure/webhooks/webhookService.ts`

### Improved

#### Performance: N+1 Query for Recent Pastes
- **Before**: Sequential KV `get()` for each recent paste + extra read to get paste ID from value
- **After**: Paste IDs extracted from key names (`recent:{timestamp}:{id}`), all pastes fetched in parallel with `Promise.all()`
- **Location**: `src/infrastructure/storage/kvPasteRepository.ts`

#### Performance: Rate Limiter Memory Leak
- **Before**: Module-level `Map` grew unbounded across requests within an isolate
- **After**: Capped at 1000 entries; expired entries evicted when limit reached; oldest entries removed as fallback
- **Location**: `src/infrastructure/security/rateLimit.ts`

#### Code Quality: Error Handling Consistency
- **Before**: Every handler had its own try/catch returning manual JSON error responses (~100 lines of duplicated boilerplate)
- **After**: Handlers throw `AppError` (or rethrow Zod errors as `ValidationError`); global `errorHandler` in `index.ts` produces all error responses
- **Location**: `src/interfaces/api/handlers.ts`

#### Code Quality: Routing Deduplication
- **Before**: Admin auth logic copy-pasted 4 times; dynamic `await import()` on every request; duplicate `/pastes` and `/pastes/` handlers
- **After**: `adminRoute()` helper function; all imports static at module level; consolidated paste index handler
- **Location**: `src/index.ts`

#### Code Quality: Config Consistency
- **Before**: Zod schema allowed 25 MiB content, config default said 1 MB
- **After**: Both set to 25 MiB, matching Cloudflare KV's actual value limit
- **Locations**: `src/application/commands/createPasteCommand.ts`, `src/infrastructure/config/config.ts`

#### Code Quality: Stale Comments & Dead Code
- **Removed**: Obsolete Phase 4 / password-hash comments throughout domain model and commands
- **Removed**: Unused `handleRateLimit()` method from `ApiMiddleware`
- **Locations**: Various files across `src/domain/`, `src/application/`, `src/interfaces/`

## [1.0.0] - 2025-12-06

### Fixed

#### View Limits & Burn After Reading
- **Incremental Read Count**: View limits now properly increment on every successful read, not just the final view
- **Pre-check Enforcement**: System now checks if view limit is already exceeded before serving content
- **Burn After Reading**: Properly deletes pastes immediately after first view
- **Location**: `src/application/queries/getPasteQuery.ts`

#### CORS Handling
- **Origin Mirroring**: When `*` is in the allowlist, the system now mirrors the `Origin` header to support credentials
- **Wildcard Fallback**: Falls back to `*` only when no Origin header is present
- **Consistent Headers**: CORS headers now added to both OPTIONS responses and normal responses
- **Request Preservation**: Uses original request when setting CORS headers
- **Locations**:
  - `src/interfaces/api/middleware.ts` (CORS logic)
  - `src/index.ts` (response header application)

#### Analytics System
- **Dedicated Storage**: Analytics events now stored in dedicated `ANALYTICS` KV namespace instead of `PASTES`
- **Graceful Degradation**: System logs warnings and continues if `ANALYTICS` namespace is not configured
- **Separate Read/Write**: Both read and write operations use the dedicated namespace
- **Locations**: `src/infrastructure/analytics/analytics.ts`

#### Admin Authentication
- **Environment Variable Support**: Admin auth now reads `ADMIN_API_KEY` from worker environment
- **Type Safety**: `Env` interface updated to include `ADMIN_API_KEY` field
- **Fallback Support**: Maintains globalThis fallback for backward compatibility
- **Proper Passing**: All admin endpoints now pass `env` to validation function
- **Locations**:
  - `src/infrastructure/auth/adminAuth.ts` (auth logic)
  - `src/types.ts` (type definition)
  - `src/index.ts` (usage)

#### Webhooks Configuration
- **Auto-Enable Logic**: Webhooks now auto-enable when `WEBHOOKS` binding exists unless explicitly disabled
- **Schema Update**: Config schema now includes `enableWebhooks` boolean field
- **Smart Initialization**: Checks config value first, then falls back to binding existence
- **Locations**:
  - `src/interfaces/api/handlers.ts` (initialization logic)
  - `src/infrastructure/config/config.ts` (schema definition)

#### Type Safety
- **KV Pagination**: Fixed TypeScript discriminated union handling for KV list results
- **Cursor Access**: Properly accesses `cursor` property only when `list_complete` is false
- **Location**: `src/infrastructure/storage/kvPasteRepository.ts`

### Configuration Required

To fully utilize the new fixes, add the following to your `wrangler.jsonc`:

```jsonc
{
  "kv_namespaces": [
    // ... existing namespaces ...
    {
      "binding": "ANALYTICS",
      "id": "your-analytics-namespace-id"
    },
    {
      "binding": "WEBHOOKS",
      "id": "your-webhooks-namespace-id"
    }
  ]
}
```

And add the admin API key as a secret:

```bash
# Generate a strong admin API key
openssl rand -hex 32

# Add it to your worker
wrangler secret put ADMIN_API_KEY
```

Or add to `wrangler.jsonc` for non-sensitive environments:

```jsonc
{
  "vars": {
    "ADMIN_API_KEY": "your-generated-key-here"
  }
}
```

### Technical Details

#### View Limits Flow
1. Check if paste exists and hasn't expired
2. **NEW**: Check if view limit already exceeded → delete and return null
3. Increment read count for every successful view
4. If burn-after-reading, delete immediately
5. **NEW**: If view limit reached after increment, schedule deletion

#### CORS Configuration Options
- `allowedOrigins: ['*']` - Mirrors Origin header for credentials, falls back to `*`
- `allowedOrigins: ['https://example.com']` - Only allows specified origins
- `allowedOrigins: []` - No CORS headers (blocks cross-origin requests)

#### Analytics KV Structure
- **Key Format**: `analytics:YYYY-MM-DD:uuid`
- **TTL**: 30 days
- **Namespace**: Dedicated `ANALYTICS` KV binding
- **Fallback**: Warns and skips if namespace missing

#### Webhook Initialization Logic
```typescript
const enableWebhooks =
  this.configService.get('enableWebhooks') ??  // Explicit config first
  (env.WEBHOOKS ? true : false);                // Auto-enable if binding exists

if (env.WEBHOOKS && enableWebhooks) {
  // Initialize webhook service
}
```
