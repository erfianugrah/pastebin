# AGENTS.md

## Project

Pasteriser — code-sharing service on Cloudflare Workers (Hono) with Astro+React frontend. Live at `paste.erfi.dev`.

Storage: **Supabase Postgres** (Frankfurt, project `dewddkcmwrzbpynylyhg`). Migrated from Cloudflare KV in May 2026 — see `SUPABASE-MIGRATION.md`.

## Structure

Two separate packages with **independent `node_modules`**:

| Path | What | Install |
|------|------|---------|
| `/` (root) | CF Worker backend (Hono router, DDD layers) | `npm install` |
| `astro/` | Static frontend (Astro + React + Tailwind v4 + shadcn/ui) | `cd astro && npm install` |

- **Worker entry**: `src/index.ts` — Hono app, all routing, serves Astro static assets via `ASSETS` binding
- **Worker config**: `wrangler.jsonc` — `run_worker_first: true`, assets from `./astro/dist`
- **DDD layers** in `src/`: `domain/` → `application/` → `infrastructure/` → `interfaces/`
- **Storage abstraction**: `PasteRepository` interface (8 methods: `save`, `findById`, `view`, `delete`, `findRecentPublic`, `searchPublic`, `resolveSlug`, `saveSlug`), three implementations: `KVPasteRepository`, `SupabasePasteRepository`, `DualWriteRepository` — selected via `STORAGE_BACKEND` env var
- **Env bindings** (`src/types.ts`):
  - `PASTES: KVNamespace` — retained for rollback, unused with current `STORAGE_BACKEND=supabase`
  - `ASSETS: Fetcher` — Astro static assets
  - `SUPABASE_URL: string` — project URL (var in `wrangler.jsonc`)
  - `SUPABASE_SECRET_KEY: string` — `sb_secret_...` key (Wrangler secret, never in source)
  - `STORAGE_BACKEND?: 'kv' | 'supabase' | 'dual'` — defaults to `supabase` in production

## Supabase migrations

- All schema in `supabase/migrations/` — 12 files, applied to `dewddkcmwrzbpynylyhg`
- Tables: `pastes`, `slugs` (see `SUPABASE-MIGRATION.md` for full schema and Phase 3.5 audit fixes)
- `set_updated_at` trigger has a `WHEN (OLD.x IS DISTINCT FROM NEW.x)` clause — required because `upsert()` sends all columns and `UPDATE OF col` fires on column presence, not value change
- `createClient()` always passes `{ auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }` — Supabase-recommended for server-side contexts
- `view_paste(uuid)` RPC handles atomic view + burn-after-reading + view-limit with `SELECT ... FOR UPDATE`. The Supabase repository uses this; KV repository mirrors the logic without locking (documented race for rollback safety only)
- `search_vector` is a STORED generated tsvector column (`to_tsvector('english', title || ' ' || language)`) backed by a GIN index. Query via `.textSearch('search_vector', q, { type: 'websearch', config: 'english' })`
- Realtime: `AFTER INSERT` trigger on `pastes` calls `realtime.send()` to topic `recent:public` (private channel) when `visibility = 'public'`. Payload is curated to safe fields only. RLS policies on `realtime.messages` restrict `anon`/`authenticated` to the exact topic. INSERT trigger does NOT fire on upsert-induced UPDATEs.
- RLS for authenticated users: 5 policies on `public.pastes` (view public, view own, create own, update own, delete own). Worker still uses `service_role` (RLS bypass); these policies activate when the frontend queries Supabase directly with a user JWT.
- Auth: Worker validates `Authorization: Bearer <jwt>` via `AuthService.getUserIdFromRequest()` which calls `supabase.auth.getUser(jwt)`. user_id comes from the verified JWT, never from the request body. Anonymous requests get `user_id = NULL`.
- Never run DDL directly via pgcli — always create a new migration file
- Verify with `supabase db query --linked "SELECT ..."` or via `pgpasteriser` alias

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
npm run test:e2e         # playwright — runs against PRODUCTION (paste.erfi.dev)
npm run test:smoke       # tsx scripts/smoke-test.ts — live API + Supabase verification
npm run test:race        # tsx scripts/concurrent-burn-test.ts — concurrent burn race-free check
npm run test:realtime    # tsx scripts/verify-realtime.ts — broadcast pipeline + RLS compat matrix
npm run test:rls         # tsx scripts/verify-rls.ts — Supabase Auth + RLS end-to-end (2 test users)
npm run test:all-live    # runs all 4 live suites in sequence with cooldowns
npm run test:all         # test + test:ui + test:e2e

# Codegen
npm run cf-typegen       # wrangler types → worker-configuration.d.ts
```

## Gotchas

- **Two install steps**: Root `npm install` does NOT install `astro/` deps. Run both.
- **Prism codegen**: `astro/public/prism-components/` is generated by `update-prism` script (copies from `astro/node_modules/prismjs/components/`). Runs automatically on `dev`/`build` in astro. Gitignored.
- **E2E tests hit production** (`paste.erfi.dev`), not local dev. Don't run casually.
- **ESLint scope**: Only `src/**/*.ts`. Astro/React code in `astro/` is not linted by root config.
- **Typecheck scope**: Root `tsconfig.json` only. Astro has its own `astro/tsconfig.json` (extends `astro/tsconfigs/base`).
- **Vitest split**: Root vitest includes `src/tests/**` + `astro/src/lib/**`. Component tests (`astro/src/components/**`) require running separately via `npm run test:ui`.
- **Astro path alias**: `@/*` → `astro/src/*` (configured in `astro/tsconfig.json`).

## Style

- **Indent**: Tabs (`.editorconfig` + `.prettierrc`)
- **Prettier**: 140 col, single quotes, semicolons, tabs
- **TypeScript**: Strict mode in both root and astro tsconfigs
