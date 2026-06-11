# Security Configuration Guide

Threat model, deployment configuration, and operational guidance for Pasteriser.

## Threat model

| Asset | Defended against | Defense |
|-------|------------------|---------|
| Plaintext paste content | Server compromise, log exposure | Client-side E2EE **on by default** for new pastes (XSalsa20-Poly1305 via NaCl `secretbox`, PBKDF2-SHA-256 300k iter for password mode, key in URL fragment for key mode). Opt out per paste via Encryption → "None". |
| Paste **title** metadata | Server / DB read, public-listing leak | version-3 pastes encrypt the title under the same key as the content (own nonce). Encrypted pastes are excluded from the public `search_vector` and their title/language are withheld from `/api/recent` + `/api/search` responses (lock placeholder in the UI). |
| Encryption keys / passwords | Server-side leakage | Never sent to server — key in URL fragment, password used client-side for PBKDF2 only |
| Paste authorship | Unauthorized creation as another user | JWT validated by Worker; `user_id` set from verified token, never from request body |
| Owned-paste access | Cross-user reads / writes / deletes | 5 RLS policies on `public.pastes` for `authenticated` role: SELECT public, SELECT/INSERT/UPDATE/DELETE own |
| Anonymous paste deletion | Anyone-knows-the-id deletion | `deleteToken` (UUID) issued at creation; required for `DELETE /pastes/:id/delete` |
| Burn-after-reading content | Race-condition double-serve | Postgres `view_paste()` RPC with `SELECT ... FOR UPDATE` row lock |
| Delete-token leakage | Token captured by request log / Referer | Rejected in query string (HTTP 400 `token_in_query`); accepted in JSON body only. Logger redacts `token`, `token_hash`, `code`, `access_token`, `refresh_token` query keys |
| Cross-site exploits | XSS via paste content | `textContent` only for user data; no `innerHTML`; programmatic DOM creation; strict CSP without `unsafe-eval` |
| Open redirect | `next` param escaping the origin | `/auth/confirm` resolves `next` via `new URL(next, request.url)` and asserts `candidate.origin === request.origin`. Closes the WHATWG-backslash bypass (`/\evil.com` would otherwise become `https://evil.com/`) |
| Cross-origin abuse | CORS-credentials with `*` origin | Explicit allowlist in production |
| Abuse / DoS via auth flood | Unbounded signup, login, email-sending | Cloudflare Workers Rate Limiting bindings on auth-write (10/min), session-read (60/min), paste-create (30/min), search (30/min), recent-feed (60/min) per IP |
| Slug squatting via TOCTOU race | Concurrent creates with same vanity slug | Postgres unique constraint on `slugs.slug`; race-loser surfaced as HTTP 409 `slug_taken` via `SlugTakenError` typed-error translation |

## Encryption layers & the trust boundary

There are three places data can be encrypted, and they protect against
*different* adversaries. The distinction is **who holds the key** and
**where decryption happens**:

| Layer | Key held by | Decryption runs | Stops outsider / stolen disk / DB dump? | Stops the host (Cloudflare / Supabase)? |
|-------|-------------|-----------------|------------------------------------------|------------------------------------------|
| **At-rest disk encryption** | Supabase (platform-managed) | on Supabase, transparently per query | ✅ | ❌ — the DB decrypts to serve every query |
| **TLS in transit** | terminated by the platform | in flight | ✅ (network snoop) | ❌ |
| **E2EE (Pasteriser, opt-in)** | the **user** (URL fragment / password) | in the **browser** | ✅ | ✅ — server only ever holds ciphertext |

Supabase's at-rest encryption is automatic and on by default, but its key
is Supabase's — it defends against a stolen disk or a leaked backup, **not**
against the operator or anyone with SQL access (the running database
decrypts transparently). The only layer that removes the host from the
trust boundary is **E2EE**, because the key never reaches the server.

### Why Pasteriser does NOT use Supabase Vault or column encryption

- **Vault** stores secrets that *the database* consumes (API keys, FDW
  passwords). It does not protect user content, and its key is
  Supabase-managed — so it would not hide paste content from the host.
  Pasteriser's only server-side secrets (`SUPABASE_SECRET_KEY`, etc.) live
  in **Cloudflare Workers secrets**, not in Postgres, so there is nothing
  for Vault to do here.
- **In-DB column encryption** (the deprecated pgsodium TCE pattern: key in
  Vault + `pgcrypto` in a trigger) keeps both the key *and* the decryption
  on Supabase, so it gives no protection against the host — only against
  logical dumps and over-privileged roles. For paste content, E2EE already
  does the real work; for everything else, at-rest disk encryption covers
  the dump/backup threat.

Net: encrypting in the database would be effort spent in the wrong place.
Content secrecy is handled client-side (E2EE); the rest is intentionally
readable by the operator and protected at rest by the platform.

### RLS is a tested backstop, not the runtime gate

The Worker uses the `service_role` key, which **bypasses RLS**. So the
actual runtime authorization is the app-level `user_id` filter (derived
from the verified JWT) plus the token-gated `delete_paste` / `update_paste`
RPCs. The 5 RLS policies are a **defense-in-depth backstop** — verified
end-to-end by `npm run test:rls` (9 scenarios / 14 assertions) — that would
scope a breach if the `service_role` key leaked or a future direct-query
path were added. They are not on the production hot path today.

### If Pasteriser ever stored regulated data (PHI / PCI)

This design is right *because* paste content is either E2EE or
intentionally public. It would **not** transfer to regulated data, and the
fix would not be "encrypt the column" or "use Vault". It would be:

- A **BAA** with every vendor in the data path (Supabase **and** Cloudflare,
  since the Worker terminates requests), plus the relevant compliance add-on.
- **Load-bearing** access control (RLS / authz genuinely enforced and
  tested), not a `service_role` backstop.
- **Audit logging** (`pgaudit`) with **per-user attribution** — which is
  engineering, not a config flag: the DB only sees the shared Postgres role,
  and Postgres has no `SELECT` trigger, so read-attribution requires
  app-level audit rows or log correlation.
- **PHI-out-of-logs hygiene** — redact-by-default logging (the query-string
  redaction in `src/index.ts` is the seed of this), `pgaudit.log_rows` /
  `log_parameter` left off, and no identifiers in URLs.

E2EE would actively be the *wrong* tool for that case — it breaks the
server-side processing/search/sharing such systems require. The trust
philosophy inverts: instead of hiding data from the host, you legally bind
and audit the host.

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
- **Realtime channel authorization** — not applicable. The Realtime broadcast trigger + RLS policies on `realtime.messages` were dropped in `20260512102410_drop_realtime_broadcast.sql` because the frontend never subscribed and the CSP `connect-src 'self'` directive physically blocked WebSocket to `*.supabase.co`. Recent-paste UX uses polling against `/api/recent` instead.
- **Paste deletion** — anonymous pastes require the `deleteToken` (UUID returned at creation), accepted in the JSON request body only. The query-string form (`?token=…`) is rejected with HTTP 400 `token_in_query` to keep the secret out of logpush, browser history, and `Referer` headers. The handler also validates `!storedToken || storedToken !== ownerToken` (inverted from the previous `storedToken &&` form so a row with a falsy stored token can't be world-deleted as defense-in-depth — the DB constraint `delete_token NOT NULL DEFAULT gen_random_uuid()` already prevents this in practice). Authenticated users can also delete via direct DB (RLS-gated by `auth.uid() = user_id`).

- **Paste update** — atomic, race-free, token-gated. `PUT /pastes/:id` goes through `update_paste(uuid, uuid, text, text, text)` Postgres RPC that takes `SELECT … FOR UPDATE` and applies a partial `UPDATE` only on token match. Same pattern as `delete_paste`. Pre-3.9.0 the handler did a read-modify-write with `.upsert()` — that had two race bugs: (1) concurrent `view_paste` increments to `read_count` would be clobbered by the upsert's stale snapshot, and (2) if `view_paste` burned the row between findById and save, the upsert's INSERT branch would **resurrect the burned paste** with new content and `read_count = 0`. The new RPC eliminates both by serialising against `view_paste` on the row lock. `read_count`, `view_limit`, `burn_after_reading`, `expires_at`, `visibility`, `version`, `is_encrypted`, `delete_token`, and `user_id` are NOT updatable via this endpoint (changing them mid-life would invalidate the security model). Body validated by `UpdatePasteSchema` (Zod): token must be a UUID, content/title/language are optional strings within size limits (25 MiB / 100 chars / 50 chars).

### Content security

- **XSS prevention** — every user-supplied string rendered via React's escaping; pastes/titles/languages are never injected as raw HTML. The single `dangerouslySetInnerHTML` call (markdown render in `CodeViewer.tsx`) feeds output from DOMPurify (defaults including `SANITIZE_DOM` + `SANITIZE_NAMED_PROPS`) with a tightly-scoped `data-slug → id` hook used only on heading elements.
- **CSP** — single layer, set as a header on every response by the Worker (`src/interfaces/api/middleware.ts`):

  ```
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  style-src-attr 'unsafe-inline';
  connect-src 'self';
  img-src 'self' data: blob:;
  font-src 'self';
  object-src 'none';
  media-src 'self';
  worker-src 'self' blob:;
  child-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  ```

  **Why `'unsafe-inline'`?** 3.8.0 attempted to use Astro v6's `security.csp` feature to emit a per-page `<meta http-equiv="content-security-policy">` with SHA-256 hashes for every bundled / inline script and style, and to drop `'unsafe-inline'` from the Worker header. That design didn't survive contact with the runtime:

  1. Per CSP3 / MDN [Multiple content security policies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#multiple_content_security_policies), policies compose by **intersection of allowances** — a request is allowed only if every policy independently permits it. The header's `script-src 'self'` (no hashes, no `'unsafe-inline'`) therefore blocked every inline script that the meta lawfully hash-permitted. The "meta wins" mental model was incorrect.
  2. Astro v6's `security.csp` always appends `script-src 'self' 'sha256-…'` and `style-src 'self' 'sha256-…'` to the meta. CSP3 §6.6.2.5 auto-disables `'unsafe-inline'` in any directive carrying a hash, so we couldn't relax the meta from the Astro side.
  3. Astro hashes inline `<style>` blocks but never inline `style="…"` attributes. Radix UI (`Select` accessibility shim) emits `<span style="pointer-events:none">` and a visually-hidden native `<select>` with an inline a11y-shim style. React components render dynamic inline styles for progress bars (PasteForm, CodeViewer, password-strength), tooltip positioning, and stagger animation (RecentPastes). All blocked by hash-based `style-src` with no escape hatch.
  4. Astro's `security.csp.directives` whitelist (see `ALLOWED_DIRECTIVES` in `astro/node_modules/astro/dist/core/csp/config.js`) excludes `style-src-attr`, `script-src-attr`, `script-src-elem`, and `style-src-elem` — Astro reserves these. We can't add `style-src-attr 'unsafe-inline'` to override the implicit fallback.
  5. Cloudflare Bot Fight Mode injects an inline JS Detection beacon (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`) at the edge with a per-request nonce in the body. The hash cannot be pre-computed at build time.

  Net: hash-based CSP is fundamentally incompatible with the codebase as long as Radix UI / React render-time inline styles and Cloudflare edge injection are in scope. CSP is downgraded to defense-in-depth (policy layer); XSS prevention in HTML is provided by:

  - React auto-escaping for every user-supplied string rendered (`{content}`).
  - DOMPurify on the single `dangerouslySetInnerHTML` call path (markdown render in `CodeViewer.tsx`).
  - No user content reflected into the HTML envelope by the Worker.

  These layers were already the real defense; the CSP hashes were never carrying the load. JSON responses also see the header above; CSP on JSON is mostly belt-and-braces against MIME-confusion attacks (also mitigated by `X-Content-Type-Options: nosniff`).

- **HSTS** — `max-age=31536000; includeSubDomains; preload`
- **X-Frame-Options** — `DENY`
- **X-Content-Type-Options** — `nosniff`
- **Referrer-Policy** — `strict-origin-when-cross-origin`
- **Permissions-Policy** — blocks geolocation, microphone, camera by default

### Rate limiting

**Worker-level (current):**

Implemented via **Cloudflare Workers Rate Limiting bindings** (`[[ratelimits]]` in `wrangler.jsonc`). Four bindings, all keyed on the client IP (`CF-Connecting-IP`, falling back to first `X-Forwarded-For` token, then `'unknown'`) plus a per-endpoint scope so each endpoint has its own bucket per IP:

| Binding | Scope | Limit | Endpoints |
|---|---|---|---|
| `RL_AUTH_WRITE` | per IP+endpoint | 10 / 60s | `POST /api/auth/{signup,login,resend-confirmation,forgot-password,update-password,magic-link}`, `GET /api/auth/oauth/:provider`, `GET /auth/confirm` |
| `RL_SESSION_READ` | per IP | 60 / 60s | `GET /api/auth/session` |
| `RL_PASTE_CREATE` | per IP+endpoint | 30 / 60s | `POST /pastes`, `PUT /pastes/:id`, `DELETE\|POST /pastes/:id/delete` |
| `RL_SEARCH` | per IP | 30 / 60s | `GET /api/search` |

`GET /auth/callback` is not rate-limited: PKCE codes are single-use and bound to a verifier cookie the legitimate flow holds — a flood here just costs one Supabase exchange per attempt with no amplification.

Blocks return `429 Too Many Requests` with `Retry-After: 60` and a structured `{ error: { code: "rate_limited", message: "..." } }` body. Implementation: `src/interfaces/api/rateLimit.ts`. Middleware fails open (passes the request) if the binding throws — never blocks real traffic on infrastructure issues.

**Properties of the CF Rate Limiting binding:**

- Counters are propagated across the Cloudflare edge — not strict (eventually consistent across PoPs) but materially better than a per-isolate in-memory map.
- Period must be 10 or 60 seconds (Cloudflare-enforced).
- Binding is absent in local dev / vitest / Playwright-against-`astro dev`; middleware no-ops gracefully (logs a `debug` line so the no-op is observable).

**Not yet implemented:**

- IP-based geo or ASN heuristics on top of per-endpoint buckets.
- Per-user buckets (signed-in users currently share the IP-keyed bucket with anonymous traffic from the same IP).
- WAF custom rules — would add zone-level protection beneath the Worker.

**Supabase-level (default):**

- `/auth/v1/token` (sign-in + refresh): per-IP, token-bucket, 30-request capacity refilling at the project rate. Customizable via Dashboard → Auth → Rate Limits.
- `/auth/v1/signup`: per-IP rate for anonymous signups; project-wide email-rate cap for confirmation emails (inbuilt SMTP defaults to ~4/hour).
- Realtime: project-wide caps (Free: 200 concurrent WS connections, 100 messages/sec, 100 channel joins/sec). Exceeding returns `too_many_connections` / `too_many_joins` on the WS.
- REST / PostgREST: no built-in rate limit on read endpoints; relies on Cloudflare gateway in front.

**Known gaps (planned for Phase 4.7):**

- No Cloudflare Turnstile CAPTCHA on `/signup` or `POST /pastes` — Supabase docs explicitly recommend this for anon flows (see `auth-captcha.md`).
- Paste size cap is 25 MiB for everyone, including anonymous — a multi-IP attacker can fill the 500 MB free Supabase tier with ~20 requests.
- No custom SMTP — inbuilt SMTP cap means email confirmations can be exhausted by a single attacker within minutes.
- `/auth/v1/signup` is browser → Supabase direct (no Worker gate). Without Turnstile this is the highest-ROI attack surface per documented Reddit / Hacker News reports.

**Known Supabase Auth rate-limiter bugs (upstream, not specific to Pasteriser):**

- [supabase/auth#1236](https://github.com/supabase/auth/issues/1236): Failed signups count toward email rate limit even when no email is sent. PR #1748 merged but behavior persists per recent reports.
- [supabase/auth#2333](https://github.com/supabase/auth/issues/2333): "Rate limit for sign-ups and sign-ins" Dashboard setting is not enforced as configured; allows ~30-50 requests before the generic burst limit kicks in. Supabase response: "this behavior is expected due to non-configurable burst limit."
- [supabase/auth#1932](https://github.com/supabase/auth/issues/1932): Rate limit doesn't apply when signup uses an already-used email (returns a fake user response). Lets attackers probe valid emails without consuming the bucket.

These bugs make the Worker-side gate (#5 in the Phase 4.7 plan) more valuable than the Supabase-side gate.

See `SUPABASE-MIGRATION.md` "Phase 4.7" for the full mitigation roadmap with citations.

### Client-side encryption

- **XSalsa20-Poly1305** (NaCl `secretbox`) via tweetnacl. Encryption happens in a Web Worker for non-blocking UX; main-thread fallback for small payloads.
- **Password mode** — PBKDF2-SHA-256 with 300,000 iterations + 16-byte salt for key derivation. Password never leaves the browser.
- **Key mode** — 256-bit random key in the URL fragment (`#key=...`). Fragment is never sent in HTTP requests.
- **Storage** — paste content stored as `[salt? nonce ciphertext+MAC]` base64. Server cannot derive the plaintext under any path.
- **Encryption versions** — `0` = plaintext; `2` = legacy E2EE (content only, plaintext title); `3` = E2EE content **and** title (the default for new encrypted pastes). The title is an independent `secretbox` blob under the same key/salt. `CodeViewer` decrypts it best-effort after the content; a failure leaves a "🔒 Encrypted paste" placeholder. version-3 pastes show a neutral `document.title` until decrypted so the ciphertext title never lands in the tab title or history.
- **Default-on** — new pastes default to key-mode E2EE. Editing an existing paste does **not** force-encrypt (the update path leaves `version`/`is_encrypted` untouched, so re-encrypting a plaintext paste would store ciphertext the viewer never decrypts).
- **Metadata minimisation** — the public `search_vector` generated column resolves to `''` for any `is_encrypted` row, so neither title nor language of an encrypted paste is world-searchable; the recent/search DTOs withhold them too.
- **QR rendering** — rendered locally in the browser via the `qrcode` npm package. Previously sent `window.location.href` (including the `#key=…` fragment) to `api.qrserver.com`; that's gone since 3.8.0.

## Security checklist

Before deploying:

- [ ] `SUPABASE_SECRET_KEY` set via `wrangler secret put` (not in `wrangler.jsonc`)
- [ ] `SUPABASE_URL` and `STORAGE_BACKEND` set in `wrangler.jsonc` vars
- [ ] `astro/.env` populated with `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] `astro/.env` gitignored
- [ ] CSP headers loaded by every response (verify in browser DevTools → Network → Response Headers)
- [ ] Paste deletion requires `deleteToken` in JSON body (test with and without token via `npm run test:smoke`)
- [ ] RLS policies live and enforced (verify via `npm run test:rls`)
- [ ] Burn-after-reading is race-free (verify via `npm run test:race`)
- [ ] Rate-limit bindings declared in `wrangler.jsonc` `[[ratelimits]]`; over-limit requests return 429 with `Retry-After: 60` (verify via repeated POSTs against `/api/auth/login` in staging)
- [ ] `wrangler dev` warns on missing rate-limit bindings; the middleware fails open (pass-through) but logs a debug line — confirm prod deploy includes the bindings

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
- The cached-key store (`astro/src/lib/secureStorage.ts`) keeps per-paste decryption keys in localStorage encrypted under a master key. **The master key lives in `sessionStorage`** (cleared on tab close) — earlier versions stored it in the same `localStorage` it "protected", which co-located key and ciphertext and provided no defense beyond casual DOM inspection. Moving the master key to sessionStorage shortens the persistence window but does not protect against XSS or browser-extension reads. Use the key cache for UX (don't re-prompt the same user), not as a security boundary.
- An attacker with disk access to the browser profile can still recover localStorage ciphertext; without the (volatile) sessionStorage master key they cannot decrypt it. After the tab closes the cached items become permanently unrecoverable, by design.
- **Delete tokens** (`pasteTokenStorage` wrapper, since 3.8.0) follow the same routing — written/read through `secureStorage`, falling back to and migrating any legacy plaintext `paste_token_<id>` entry. Same caveat: XSS that can read both `localStorage` AND `sessionStorage` defeats this layer.
- No key-rotation flow is implemented; encrypted pastes are immutable.

### Browser requirements

- Modern browser with Web Crypto API (everything > 2017).
- Web Workers required for non-blocking encryption of large pastes (>500 KB). Main-thread fallback present but blocks the UI.
- Service Workers used for caching; Safari's private-browsing mode degrades this gracefully.
