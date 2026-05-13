# AGENTS.md

## Project

Pasteriser — code-sharing service on Cloudflare Workers (Hono) with Astro+React frontend. Live at `paste.erfi.io`.

Storage: **Supabase Postgres** (Frankfurt, project `dewddkcmwrzbpynylyhg`). Migrated from Cloudflare KV in May 2026 — see `SUPABASE-MIGRATION.md`.

## CSP

Two-layer CSP since 3.8.0:

1. **Header**: `src/interfaces/api/middleware.ts` — strict directives, **no `'unsafe-inline'`**. Includes header-only directives (`frame-ancestors`, `base-uri`, `form-action`, etc.) that `<meta>` CSP cannot express.
2. **Meta tag**: Astro 6's `security.csp` (configured in `astro/astro.config.mjs`) emits a per-page `<meta http-equiv="content-security-policy">` with SHA-256 hashes for every bundled and inline script/style in that page.

Browser AND-s both: meta is the more specific (carries hashes), and `'unsafe-inline'` is implicitly disabled in any directive that has a hash. To add a new inline script: just write it in an `.astro` file — Astro hashes it automatically at build time. JSON / API responses see only the header (no inline scripts in JSON anyway).

`api.qrserver.com` was removed from `img-src` when QR rendering moved client-side (B2). Adding any new third-party host requires touching BOTH the Worker header (for non-HTML responses) AND Astro `security.csp.directives` (for HTML).

## Structure

Two separate packages with **independent `node_modules`**:

| Path | What | Install |
|------|------|---------|
| `/` (root) | CF Worker backend (Hono router, DDD layers) | `npm install` |
| `astro/` | Static frontend (Astro + React + Tailwind v4 + shadcn/ui) | `cd astro && npm install` |

- **Worker entry**: `src/index.ts` — Hono app, all routing, serves Astro static assets via `ASSETS` binding
- **Worker config**: `wrangler.jsonc` — `run_worker_first: true`, assets from `./astro/dist`
- **DDD layers** in `src/`: `domain/` → `application/` → `infrastructure/` → `interfaces/`
- **Storage abstraction**: `PasteRepository` interface (10 methods: `save`, `findById`, `view`, `delete`, `deleteWithToken`, `findRecentPublic`, `searchPublic`, `getPublicStats`, `resolveSlug`, `saveSlug`). One implementation: `SupabasePasteRepository`. KV bindings + `DualWriteRepository` removed in Phase 5.
- **Env bindings** (`src/types.ts`):
  - `ASSETS: Fetcher` — Astro static assets
  - `SUPABASE_URL: string` — project URL (Wrangler secret, never in source)
  - `SUPABASE_SECRET_KEY: string` — `sb_secret_...` (Wrangler secret, never in source)
  - `wrangler.jsonc` has no `vars` block; the two required secrets are listed only in the JSONC comment at the top of the file
  - `RL_AUTH_WRITE: RateLimit?`, `RL_SESSION_READ: RateLimit?`, `RL_PASTE_CREATE: RateLimit?`, `RL_SEARCH: RateLimit?` — Cloudflare Workers Rate Limiting bindings declared in `[[ratelimits]]`. Optional in the type so vitest + local astro dev keep working (middleware no-ops with a debug log when missing).

## Rate limiting

- Implementation: `src/interfaces/api/rateLimit.ts` (middleware factory) + `[[ratelimits]]` blocks in `wrangler.jsonc` (one per env: top-level for dev with `namespace_id` 1001-1004; under `env.production` with namespace_id 2001-2004 — namespace_ids must be unique within the Cloudflare account and stable across deploys).
- Buckets (all keyed on `CF-Connecting-IP` → `X-Forwarded-For[0]` → `'unknown'`, scoped per endpoint):
  - `RL_AUTH_WRITE` 10/60s — `POST /api/auth/{signup,login,resend-confirmation,forgot-password,update-password,magic-link}`
  - `RL_SESSION_READ` 60/60s — `GET /api/auth/session`
  - `RL_PASTE_CREATE` 30/60s — `POST /pastes`
  - `RL_SEARCH` 30/60s — `GET /api/search`
- Over-limit returns 429 + `Retry-After: 60` + `{ error: { code: "rate_limited", message: "..." } }`. Middleware **fails open** on binding error (logs warn) and **no-ops** when binding is undefined (logs debug) — never blocks real traffic on infrastructure issues.
- 7 unit tests in `src/tests/interfaces/api/rateLimit.test.ts`. `__test__.clientKey` is the only exported test seam.

## Supabase migrations

- All schema in `supabase/migrations/` — 17 files, applied to `dewddkcmwrzbpynylyhg`
- Tables: `pastes`, `slugs` (see `SUPABASE-MIGRATION.md` for full schema and Phase 3.5 audit fixes)
- `set_updated_at` trigger has a `WHEN (OLD.x IS DISTINCT FROM NEW.x)` clause — required because `upsert()` sends all columns and `UPDATE OF col` fires on column presence, not value change
- `createClient()` always passes `{ auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }` — Supabase-recommended for server-side contexts. The three Worker call sites (`SupabasePasteRepository`, `AuthService`, `AuthHandlers`) go through `getServiceRoleClient(url, key)` in `src/infrastructure/supabase/getSupabaseClient.ts` which memoises by `(url, key)`. The cached client is stateless given the auth flags above. PKCE-flow clients in `handleOAuthStart`/`handleOAuthCallback` still call `createClient` directly because they inject a custom storage shim that's not safe to share. Tests reset the cache via `__resetSupabaseClientCache()` in `beforeEach`.
- `view_paste(uuid)` RPC handles atomic view + burn-after-reading + view-limit with `SELECT ... FOR UPDATE`. The Supabase repository uses this; KV repository mirrors the logic without locking (documented race for rollback safety only)
- `delete_paste(uuid, uuid)` RPC handles atomic delete-with-token in a single round-trip (replaces the legacy findById + delete two-step). Returns `(was_found, was_deleted)` so handlers distinguish 404 / 403 / 200. Same SECURITY DEFINER pattern as `view_paste`; granted to `service_role` only.
- `search_vector` is a STORED generated tsvector column (`to_tsvector('english', title || ' ' || language)`) backed by a GIN index. Query via `.textSearch('search_vector', q, { type: 'websearch', config: 'english' })`
- Realtime: not used. The migration `20260512102410_drop_realtime_broadcast.sql` removes the dead `broadcast_public_paste_insert` trigger and RLS policies on `realtime.messages`. The frontend has no supabase-js client and CSP (`connect-src 'self'`) blocks WebSocket to `*.supabase.co`. Recent-paste UX is polling-based (`GET /api/recent`).
- RLS for authenticated users: 5 policies on `public.pastes` (view public, view own, create own, update own, delete own). Worker still uses `service_role` (RLS bypass); these policies activate when the frontend queries Supabase directly with a user JWT.
- Auth: Worker validates the session via `AuthService.getUserIdFromRequest()` which reads the `sb-access-token` HttpOnly cookie first (cookie wins over `Authorization: Bearer`) and calls `supabase.auth.getUser(jwt)`. user_id comes from the verified JWT, never from the request body. Anonymous requests get `user_id = NULL`.
- Email confirmation flow (Path C): the Worker hosts `/auth/confirm` (in `src/index.ts`), which calls `supabase.auth.verifyOtp({ token_hash, type })` server-side and sets the HttpOnly session cookies, then 302s to a same-origin `next` (default `/`). Supabase Site URL is `https://paste.erfi.io` and the confirmation email template uses `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/my`. **The `type=` value MUST be hardcoded** — the `{{ .EmailActionType }}` template variable is NOT available on the confirmation/recovery/magic_link/invite email contexts and renders as empty string. All 5 templates (confirmation/recovery/magic_link/invite/email_change) hardcode their respective type.
- **Config IaC**: project-level Supabase config lives in `supabase/config.toml` (auth, SMTP, OAuth providers, email templates referenced by `content_path`, rate limits). Secrets via `env(VAR)` substitution from `.env`. Apply with `supabase config push`. The Management API (`PATCH /v1/projects/{ref}/config/auth`) is the only way to **read** live state — there's no `config pull`.
- **For operational workflows** (Dashboard vs CLI vs Management API decision tree, migration application, config change recipes, debug guides for stuck auth flows, identity-linking verification queries, rollback strategies) — see [`SUPABASE-GUIDES.md`](./SUPABASE-GUIDES.md).
- **Auth flows shipped**: signup, login, logout, session, resend-confirmation, forgot-password, update-password, magic-link, OAuth (github), confirm. All routes in `src/index.ts`. Handlers in `src/interfaces/api/authHandlers.ts`. Cookie-first JWT extraction. 172 unit tests cover every handler.
- **`/auth/confirm?next=…` open-redirect defence**: handler builds `new URL(next, request.url)` and accepts the result only if `candidate.origin === url.origin`. Closes the WHATWG-backslash bypass where `next=/\evil.com` would resolve to `https://evil.com/`. Tested with 5 attack vectors (backslash, protocol-relative, fully-qualified URL, `javascript:`, `data:`).
- **GitHub OAuth + automatic identity linking**: when a user signs up via email/password (confirmed) and later uses GitHub OAuth with the same verified email, Supabase auto-links to the same `auth.users` row. Two rows in `auth.identities` (provider=email + provider=github), same `user_id`, `auth.uid()` unchanged for RLS. No code change required — this is default GoTrue behavior on verified-email match.
- **OAuth PKCE in Worker**: `handleOAuthStart` uses a capture-only storage object to extract the PKCE verifier that supabase-js writes during `signInWithOAuth()`, stashes it in a short-lived HttpOnly `sb-pkce-verifier` cookie (SameSite=Lax for cross-origin top-level redirect from Supabase). `handleOAuthCallback` seeds the verifier back into storage and calls `exchangeCodeForSession()`. No browser supabase-js needed.
- Custom SMTP: `smtp.resend.com:465`, user=`resend`, pass=Resend API key, sender=`noreply@erfi.io`. `rate_limit_email_sent: 30/hour`. `erfi.io` is the verified Resend domain (region `eu-west-1`).
- Login distinguishes `email_not_confirmed` (HTTP 403) from `invalid_credentials` (HTTP 401). Supabase only returns `email_not_confirmed` when the password is correct, so anti-enumeration is preserved for wrong-password guesses.
- Signup detects Supabase's anti-enumeration response (`user.identities = []` on success) and returns HTTP 409 `email_taken` instead of the misleading "needsConfirm" path.
- `/api/auth/resend-confirmation` (POST `{ email }`) — Frontend calls this on `email_not_confirmed` errors and from the signup-success panel. Always returns 200 (Supabase rate-limit handles abuse).
- `handleDeletePaste` reads `body.token` on BOTH `DELETE` and `POST` methods. Earlier version only read body on DELETE; POST + JSON body silently fell through to query-param-only auth → always 403. Verified by 2 regression unit tests (`handlers.test.ts`). Since 3.7.0, `?token=…` in the query string is **rejected with HTTP 400 `token_in_query`** to keep secrets out of Cloudflare logpush (the global request logger emits `Object.fromEntries(url.searchParams)`). The logger also redacts five known-sensitive keys: `token`, `token_hash`, `code`, `access_token`, `refresh_token`.
- **Server-side query-string logger redaction**: `SENSITIVE_QUERY_KEYS` set in `src/index.ts` is allowlist-style (add, never remove). Any new endpoint that puts a secret in a query param should add the key here and consider whether the endpoint should reject it outright (like the delete handler does).
- Never run DDL directly via pgcli — always create a new migration file
- Verify with `supabase db query --linked "SELECT ..."` or via `pgpasteriser` alias
- **Explicit GRANTs are MANDATORY for every new `public.*` table** (rule applies after Supabase's Oct 30, 2026 cutover — see [Supabase changelog 45329](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)). Existing tables (`pastes`, `slugs`) keep their grants; this rule only constrains NEW migrations. The Worker uses `service_role` so that grant is the minimum required:
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.new_table TO service_role;
  -- only add anon/authenticated grants if the frontend queries Supabase
  -- directly with a user JWT — pasteriser does NOT (BFF pattern through
  -- the Worker; CSP `connect-src 'self'` blocks browser→Supabase WSS too).
  ```
  Same for functions:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.new_fn(...) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.new_fn(...) TO service_role;
  ```
  `npm run check:migrations` (CI) greps for `CREATE TABLE public.` without a matching `GRANT … TO service_role` in the same file and fails the build.

## Commands

```bash
# Dev
npm run dev:all          # Astro UI (port 3000) + Worker (port 8787) concurrently
npm run dev:ui           # Astro only
npm run dev              # Worker only (wrangler dev)

# Build — UI must build first (outputs to astro/dist/)
npm run build:ui         # Astro build (also runs update-prism)
npm run build            # build:ui + wrangler build

# Deploy
npm run deploy           # build:ui + wrangler deploy
npm run deploy:prod      # build:ui + wrangler deploy --env production

# Quality
npm run check            # tsc --noEmit (root tsconfig only)
npm run lint             # eslint — src/**/*.ts only, not astro code
npm test                 # vitest run (src/tests/** + astro/src/lib/**)
npm run test:ui          # cd astro && npx vitest run (component tests, jsdom)
npm run test:e2e         # playwright — runs against PRODUCTION (paste.erfi.io)
npm run test:smoke       # tsx scripts/smoke-test.ts — live API + Supabase verification
npm run test:race        # tsx scripts/concurrent-burn-test.ts — concurrent burn race-free check
npm run test:rls         # tsx scripts/verify-rls.ts — Supabase Auth + RLS end-to-end (2 test users)
npm run test:all-live    # runs all 3 live suites in sequence with cooldowns
npm run test:all         # test + test:ui + test:e2e

# Same live scripts wrapped with `wrangler tail --env production`
# so Worker logs (errors, exceptions, console.log) stream interleaved
# with the test output. Useful when prod returns 500 + opaque error body.
npm run test:smoke:tail
npm run test:race:tail
npm run test:rls:tail
npm run test:all-live:tail
npm run test:e2e:tail

# Codegen
npm run cf-typegen       # wrangler types → worker-configuration.d.ts
```

## Gotchas

- **Two install steps**: Root `npm install` does NOT install `astro/` deps. Run both.
- **Prism codegen**: `astro/public/prism-components/` is generated by `update-prism` script (copies from `astro/node_modules/prismjs/components/`). Runs automatically on `dev`/`build` in astro. Gitignored.
- **E2E tests hit production** (`paste.erfi.io`), not local dev. Don't run casually.
- **ESLint scope**: Only `src/**/*.ts`. Astro/React code in `astro/` is not linted by root config.
- **Typecheck scope**: Root `tsconfig.json` only. Astro has its own `astro/tsconfig.json` (extends `astro/tsconfigs/base`).
- **Vitest split**: Root vitest includes `src/tests/**` + `astro/src/lib/**`. Component tests (`astro/src/components/**`) require running separately via `npm run test:ui`.
- **Astro path alias**: `@/*` → `astro/src/*` (configured in `astro/tsconfig.json`).

## Style

- **Indent**: Tabs (`.editorconfig` + `.prettierrc`)
- **Prettier**: 140 col, single quotes, semicolons, tabs
- **TypeScript**: Strict mode in both root and astro tsconfigs
