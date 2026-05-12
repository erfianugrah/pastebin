# Supabase-gripes follow-up plan

Source: `/home/erfi/supabase/supabase-gripes-research.md` §15 (pastebin critical review).

**Status**: each claim has been verified against current code. The research
made 16 claims; **2 were refuted, 12 confirmed (some downgraded), 2 partial**.
Working on branch `ui/overhaul` — same branch as the UI overhaul commit.

## Verification table

| # | Claim | Verdict | Notes |
|---|---|---|---|
| C1 | `handleUpdatePassword` shared-client race | **REFUTED** | `AuthHandlers` is per-request (`index.ts:106`). `this.client` is unique per request. Each `createClient()` returns a fresh GoTrueClient. No cross-request mutation. |
| C2 | `admin.signOut(jwt)` is a bug | **REFUTED** | Verified in `node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.js`: signature is `signOut(jwt, scope)`; JWT is the correct param. Non-admin `_signOut` internally calls `admin.signOut(accessToken, scope)`. Original code was correct. |
| C3 | No rate limiting; SECURITY.md describes it as existing | **CONFIRMED** | Zero rate-limit code. SECURITY.md:99-101 falsely describes a per-IP cache + per-endpoint limits. |
| C4 | `delete_token` null guard logic inverted | **CONFIRMED (low impact)** | `deletePasteCommand.ts:48` falls through on falsy `storedToken`. DB constraint + auto-generation make real exploitability ~zero. Defense-in-depth fix. |
| H1 | `safeNext` prefix check exploitable | **CONFIRMED (exploitable)** | Verified empirically: `new URL('/\evil.com', baseUrl)` → `https://evil.com/`. WHATWG URL parser maps `\` to `/` in special schemes. Backslash bypasses `!startsWith('//')`. Real open redirect after login confirm. |
| H2 | Delete token in query + logged | **CONFIRMED** | `handlers.ts:120` reads `?token=`. `index.ts:67` logs `Object.fromEntries(url.searchParams)`. Token in Cloudflare logpush. |
| H3 | Dead Realtime trigger burning quota | **CONFIRMED** | Migration `20260511132703` registers trigger calling `realtime.send()`. No client subscription in `astro/src/`. CSP blocks any future client. |
| H4 | `language` unbounded → GIN bloat | **CONFIRMED** | `createPasteCommand.ts:17` has no `max()`. Concatenated into `search_vector`. |
| H5 | `secureStorage` master key co-located | **CONFIRMED** | `secureStorage.ts:21` stores master key in localStorage. Fix: move to sessionStorage + docs honesty in SECURITY.md. |
| H6 | pg-cron unbatched DELETE | **CONFIRMED** | `20260412074417_schedule_cleanup_jobs.sql` — no `LIMIT` on either cron job. |
| M2 | `handleMyPastes` no pagination | **CONFIRMED** | `authHandlers.ts:386` caps at 100, no cursor. |
| M3 | Private pastes UUID-only | **DESIGN CHOICE** | Acknowledged design model. UI surfacing is a separate product task. Out of scope. |
| M4 | `handleSession` is JWT oracle + 15s polling | **PARTIAL** | Oracle aspect real (attacker can probe with `Cookie: sb-access-token=<stolen>`). 15s polling claim is **WRONG** — `useAuth.ts` does single fetch on mount, no setInterval. Fold into [C3] rate limiting. |
| M5 | `password` field server-side | **CONFIRMED** | `createPasteCommand.ts:20` accepts `password`. Used as encryption-flag signal (line 57). Plaintext crosses Worker. |
| M6 | Slug TOCTOU → 500 | **CONFIRMED** | `saveSlug` re-throws raw error message; race-loser gets 500 with Postgres detail. |
| A1 | Per-request service allocation | **CONFIRMED** | `index.ts:79-106` — 10+ allocations including 3 `createClient()` calls per request. |

## Final scope — all complete

**Critical**
- [x] **[C3]** Rate limiting (Cloudflare Rate Limiting binding); fix SECURITY.md
- [x] **[H1]** Open redirect — validate `next` post-URL-construction with origin equality

**High**
- [x] **[H2/M1]** Reject `?token=` on delete; redact `token` from request log
- [x] **[H3]** Drop dead Realtime trigger via new migration
- [x] **[H4]** Cap `language` length (50 chars)
- [x] **[H5]** Move master key to sessionStorage + honest SECURITY.md notes
- [x] **[H6]** Add `LIMIT 1000` to pg-cron expiry batches

**Medium**
- [x] **[M2]** Cursor-based pagination on `/api/my`
- [x] **[M5]** Remove `password` from server-side Zod schema
- [x] **[M6]** Catch `23505` in `saveSlug` → `AppError(409, 'slug_taken', ...)`

**Low (defense-in-depth + perf)**
- [x] **[C4]** Invert null guard in `deletePasteCommand`
- [x] **[A1]** Cache Supabase clients via `getServiceRoleClient` — eliminates 3 `createClient` calls per request (the heavy per-request cost). Stateless service objects remain per-request (cheap).

**Already done in current session (incidental improvement)**
- [x] `admin.signOut(jwt, 'global')` — added explicit `'global'` scope flag for cross-device revocation (replaced the type-cast hack with the real typed call). Not a bug fix; just cleanup.

**Out of scope**
- C1 (refuted — `AuthHandlers` is per-request, no shared client state)
- C2 (refuted — JWT IS the correct param to `admin.signOut`)
- M3 (design model, not code)
- M4 polling (frontend doesn't poll); oracle aspect folded into C3 rate-limit

## Verification gates (final)

| Gate | Result |
|---|---|
| Unit tests | **224 / 224** (213 prior + 11 new: rateLimit 7, paste-create 5 for H4/M5/M6, paste-delete 2 for C4, my-pastes 2 for M2, confirm 5 for H1, delete handler 1 for H2) |
| Component tests | **25 / 25** |
| Local Playwright | **5 / 5** |
| Typecheck | clean |
| Lint | clean |
| Build | clean |
| Supabase migrations applied | `20260512102410_drop_realtime_broadcast.sql`, `20260512102704_batch_expiry_cleanup.sql` (both verified via `pg_trigger` / `cron.job` queries) |

## Phases

### Phase 1 — Quick wins (touch ≤ 2 files each)
- [ ] H1 — open redirect: validate via origin equality after `new URL(next, request.url)`
- [ ] H4 — `language: z.string().max(50).optional()`
- [ ] M5 — drop `password` from `CreatePasteSchema`; require explicit `isEncrypted` from client
- [ ] M6 — `saveSlug` catches `23505` → throws typed `AppError('slug_taken', 409)`; `createPasteCommand` translates the `slugTaken` precheck error to the same
- [ ] C4 — invert null guard
- Tests updated per change; build + typecheck + lint clean

### Phase 2 — Delete-token surface (H2/M1)
- [ ] `handleDeletePaste` reads token from body only; reject `?token=` with 400
- [ ] `index.ts` request logger redacts known sensitive query keys (`token`, `code`, `token_hash`)
- [ ] Update e2e prod spec if it sent `?token=` (verify via inspection)
- Tests

### Phase 3 — Open: Rate limiting (C3 + M4)
- [ ] Add `wrangler.jsonc` rate-limit bindings (CF Workers Rate Limiting API). 4 buckets:
  - `RL_AUTH_WRITE`: 5/60s per IP — signup, login, magic-link, forgot-password, resend-confirmation, update-password
  - `RL_SESSION_READ`: 60/60s per IP — `GET /api/auth/session`
  - `RL_PASTE_CREATE`: 30/60s per IP — `POST /pastes`
  - `RL_SEARCH`: 30/60s per IP — `GET /api/search`
- [ ] `src/interfaces/middleware/rateLimit.ts` — thin helper: given a binding + key (IP) → returns `null` on pass, `Response` 429 on block. Graceful no-op when binding missing (local dev / tests).
- [ ] Wire into `src/index.ts` per endpoint
- [ ] Unit test for the helper + a smoke-style test verifying binding stub returns 429 when over limit
- [ ] Rewrite SECURITY.md "Rate limiting" section to describe what actually exists

### Phase 4 — Realtime cleanup (H3)
- [ ] New migration `<ts>_drop_realtime_broadcast.sql`:
  ```sql
  DROP TRIGGER IF EXISTS broadcast_public_paste_insert_trigger ON public.pastes;
  DROP FUNCTION IF EXISTS public.broadcast_public_paste_insert();
  DROP POLICY IF EXISTS ... ON realtime.messages;
  ```
- [ ] Update `SUPABASE-MIGRATION.md` + `AGENTS.md` to remove Realtime references
- [ ] Apply migration to remote DB (manual step noted in plan)

### Phase 5 — pg-cron batching (H6)
- [ ] New migration `<ts>_batch_expiry_cleanup.sql`:
  ```sql
  SELECT cron.unschedule('cleanup-expired-pastes');
  SELECT cron.unschedule('cleanup-expired-slugs');
  SELECT cron.schedule('cleanup-expired-pastes', '*/5 * * * *', $$
    DELETE FROM public.pastes WHERE id IN (
      SELECT id FROM public.pastes WHERE expires_at < now() LIMIT 1000
    )
  $$);
  SELECT cron.schedule('cleanup-expired-slugs', '*/15 * * * *', $$
    DELETE FROM public.slugs WHERE slug IN (
      SELECT slug FROM public.slugs WHERE expires_at < now() LIMIT 1000
    )
  $$);
  ```
- [ ] Apply migration to remote DB

### Phase 6 — Pagination (M2)
- [ ] Repository: `findByUserId(userId, { limit, before })` with keyset cursor (created_at + id tiebreaker)
- [ ] Handler: accept `?cursor=<iso>&limit=<n>` (max 50); return `{ pastes, nextCursor: string | null }`
- [ ] Frontend `MyPastes.tsx`: "Load more" button when `nextCursor !== null`
- Tests

### Phase 7 — secureStorage hardening + SECURITY.md (H5)
- [ ] Move master key to `sessionStorage` (cleared on tab close) — reduces persistence window
- [ ] Add SECURITY.md note: master key in browser storage provides zero XSS protection. Client-side encryption protects against server-side compromise only.

### Phase 8 — Service singletons (A1)
- [ ] Module-level cache in `src/index.ts`:
  ```ts
  let cached: { env: Env; services: AppServices } | null = null;
  function getServices(env: Env, logger: Logger): AppServices {
    if (!cached || cached.env !== env) cached = { env, services: buildServices(env) };
    // logger is request-scoped, attached at handler invocation
    return { ...cached.services, logger };
  }
  ```
- [ ] Pass `logger` through method signatures where needed (most repository methods accept logger via DI on constructor → need to re-think the logger scoping)
- [ ] Alternative simpler approach: cache only the three `createClient` calls; keep service objects per-request. The Supabase client allocation is the expensive bit (HTTP agent setup, etc.).

### Phase 9 — Verification
- Lint, typecheck, all unit tests, all component tests, local e2e, build
- Commit per-phase OR squash — decide at the end

## Files touched (estimated)

| Area | Files |
|------|-------|
| Auth handlers | `src/interfaces/api/authHandlers.ts`, tests |
| Delete handler | `src/interfaces/api/handlers.ts`, tests |
| Create paste cmd | `src/application/commands/createPasteCommand.ts`, tests |
| Delete paste cmd | `src/application/commands/deletePasteCommand.ts`, tests |
| Repository | `src/infrastructure/storage/supabasePasteRepository.ts` |
| Logger redaction | `src/index.ts` |
| Rate limit | `src/interfaces/middleware/rateLimit.ts` (new), `wrangler.jsonc`, `src/index.ts`, `src/types.ts` |
| Migrations | 2 new files in `supabase/migrations/` |
| Frontend | `astro/src/lib/secureStorage.ts`, `astro/src/components/MyPastes.tsx`, `astro/src/components/PasteForm.tsx` (remove password from POST body) |
| Docs | `SECURITY.md`, `SUPABASE-MIGRATION.md`, `AGENTS.md` |
