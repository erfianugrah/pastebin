# Security Configuration Guide

Threat model, deployment configuration, and operational guidance for Pasteriser.

## Threat model

| Asset | Defended against | Defense |
|-------|------------------|---------|
| Plaintext paste content | Server compromise, log exposure | Optional client-side E2EE (AES-GCM, key in URL fragment) |
| Encryption keys / passwords | Server-side leakage | Never sent to server — key in URL fragment, password used client-side for PBKDF2 only |
| Paste authorship | Unauthorized creation as another user | JWT validated by Worker; `user_id` set from verified token, never from request body |
| Owned-paste access | Cross-user reads / writes / deletes | 5 RLS policies on `public.pastes` for `authenticated` role: SELECT public, SELECT/INSERT/UPDATE/DELETE own |
| Anonymous paste deletion | Anyone-knows-the-id deletion | `deleteToken` (UUID) issued at creation; required for `DELETE /pastes/:id/delete` |
| Burn-after-reading content | Race-condition double-serve | Postgres `view_paste()` RPC with `SELECT ... FOR UPDATE` row lock |
| Realtime broadcasts | Private-paste metadata leakage | 3-layer defense: trigger filters `visibility = 'public'`, payload curates to safe fields, RLS on `realtime.messages` scopes to the `recent:public` topic |
| Cross-site exploits | XSS via paste content | `textContent` only for user data; no `innerHTML`; programmatic DOM creation; strict CSP without `unsafe-eval` |
| Cross-origin abuse | CORS-credentials with `*` origin | Explicit allowlist in production |

## Configuration

### Required Wrangler secret

```bash
wrangler secret put SUPABASE_SECRET_KEY --env production
# Paste an sb_secret_... value when prompted.
```

This is the only secret the Worker needs at runtime. It bypasses RLS — every code path that uses it must enforce its own authorization (the Worker does this for paste creation by deriving `user_id` from the verified JWT, never from the request body).

### Public env

`wrangler.jsonc` vars (committed):

```jsonc
{
  "vars": {
    "SUPABASE_URL": "https://<ref>.supabase.co",
    "STORAGE_BACKEND": "supabase"
  }
}
```

`astro/.env` (gitignored, baked into the client bundle at build):

```bash
PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The publishable key is safe to ship — it maps to the `anon` Postgres role and is RLS-gated.

### Optional

- `ALLOWED_ORIGINS` (comma-separated) — restricts CORS. Defaults to localhost-only in development.

## Implementation details

### Authentication and authorization

- **Worker JWT verification** (`src/infrastructure/auth/authService.ts`) — extracts `Authorization: Bearer <jwt>`, validates via `supabase.auth.getUser()` (network call to Supabase Auth). Invalid/expired/revoked tokens return `null` cleanly.
- **`user_id` derivation** — the verified user id is passed to `CreatePasteCommand.execute(params, { userId })`. Request body cannot override it.
- **RLS policies on `public.pastes`** (Postgres `pg_policy`):
  - `anon`: SELECT where `visibility = 'public'`
  - `authenticated`: SELECT public (mirrors anon), SELECT own (`auth.uid() = user_id`), INSERT with `WITH CHECK auth.uid() = user_id`, UPDATE with USING + WITH CHECK both pinned, DELETE own
  - All use `(SELECT auth.uid())` not `auth.uid()` for initPlan caching (per Supabase RLS-Performance benchmarks: 94-99% improvement at scale)
- **Realtime channel authorization** (`realtime.messages`) — two SELECT policies restrict `anon`/`authenticated` to the exact topic `recent:public`. A malicious broadcast to any other topic could not reach those roles.
- **Paste deletion** — anonymous pastes require the `deleteToken` (UUID returned at creation). Authenticated users can also delete via direct DB (RLS-gated by `auth.uid() = user_id`).

### Content security

- **XSS prevention** — every user-supplied string rendered via React's escaping; pastes/titles/languages are never injected as raw HTML. No `dangerouslySetInnerHTML`.
- **CSP** — strict `script-src 'self'`, no `unsafe-eval`, Web Workers via `worker-src blob:`:

  ```
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  connect-src 'self' https://<supabase-host> wss://<supabase-host>;
  img-src 'self' data: blob:;
  font-src 'self';
  object-src 'none';
  media-src 'self';
  worker-src 'self' blob:;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  ```

- **HSTS** — `max-age=31536000; includeSubDomains; preload`
- **X-Frame-Options** — `DENY`
- **X-Content-Type-Options** — `nosniff`
- **Referrer-Policy** — `strict-origin-when-cross-origin`
- **Permissions-Policy** — blocks geolocation, microphone, camera by default

### Rate limiting

- Per-IP cache, bounded at 1000 entries with auto-eviction of expired entries (prevents unbounded growth).
- KV-backed for cross-isolate consistency.
- Stricter limits for write paths (10/min for `POST /pastes`) than reads (60/min general).
- Path-based bypass-prevention — static assets exempt by extension allowlist, not by URL prefix that user content could spoof.

### Client-side encryption

- **AES-GCM-256** via Web Crypto API. Encryption happens in a Web Worker for non-blocking UX.
- **Password mode** — PBKDF2 with the project's iteration count for key derivation. Password never leaves the browser.
- **Key mode** — 256-bit random key in the URL fragment (`#key=...`). Fragment is never sent in HTTP requests.
- **Storage** — paste content stored as ciphertext + IV. Server cannot derive the plaintext under any path.

## Security checklist

Before deploying:

- [ ] `SUPABASE_SECRET_KEY` set via `wrangler secret put` (not in `wrangler.jsonc`)
- [ ] `SUPABASE_URL` and `STORAGE_BACKEND` set in `wrangler.jsonc` vars
- [ ] `astro/.env` populated with `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] `astro/.env` gitignored
- [ ] CSP headers loaded by every response (verify in browser DevTools → Network → Response Headers)
- [ ] Paste deletion requires `deleteToken` (test with and without token via `npm run test:smoke`)
- [ ] RLS policies live and enforced (verify via `npm run test:rls`)
- [ ] Realtime broadcasts curated correctly (verify via `npm run test:realtime`)
- [ ] Burn-after-reading is race-free (verify via `npm run test:race`)

## Monitoring

Worker logs include:

- Failed JWT validations (debug level — these are often noise from probing)
- Rate-limit triggers (info level)
- Repository errors (error level)
- RLS denial responses (surfaced as Postgres errors at error level)
- Cron job runs (visible in `cron.job_run_details`)

For ongoing monitoring, point Cloudflare's logs to a sink and query for:
- HTTP 401 / 403 spikes (potential auth abuse)
- HTTP 429 spikes (potential DDoS or aggressive scraper)
- Postgres errors mentioning `row-level security policy` (potential client misuse)

## Reporting security issues

If you discover a security vulnerability:

1. Do **not** open a public GitHub issue.
2. Contact the maintainer privately.
3. Provide steps to reproduce and the scope of impact.
4. Allow reasonable time for a fix before public disclosure.

## Inherent limitations

### Client-side encryption can't protect against the client

- Decrypted content is visible in browser memory, DevTools, and to other extensions / scripts running in the same origin.
- Locked-down browsers with no DevTools / no extensions raise the bar but the content is still loaded in JS-readable memory.
- This is a fundamental limitation, not specific to Pasteriser.

### Key management

- Encryption keys are derived from URLs or passwords. URL-based keys are exposed to anyone with the link; password-based keys are only as strong as the password.
- Keys saved to localStorage are encrypted with a per-session master key, but a local attacker with disk access can still recover them.
- No key-rotation flow is implemented; encrypted pastes are immutable.

### Browser requirements

- Modern browser with Web Crypto API (everything > 2017).
- Web Workers required for non-blocking encryption of large pastes (>500 KB). Main-thread fallback present but blocks the UI.
- Service Workers used for caching; Safari's private-browsing mode degrades this gracefully.
