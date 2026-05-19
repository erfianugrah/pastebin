# Changelog

## [3.9.0] - 2026-05-19

Verified code-review fixes. CSP rewrite + atomic update RPC + missing
rate limits + per-request auth-client + Zod row validation + dead-code
removal. 287 unit tests (was 251). 18 migrations.

### Critical / High — security

- **CSP rewrite — single-layer header, Astro CSP disabled.** 3.8.0
  introduced a two-layer design: Worker header with
  `script-src 'self'; style-src 'self'` (no hashes, no `'unsafe-inline'`)
  plus an Astro 6 `security.csp` meta tag carrying SHA-256 hashes. The
  claim that "meta with hashes wins" was incorrect — per
  [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#multiple_content_security_policies)
  and CSP3, multiple policies on a resource compose by **intersection
  of allowances** ("can only further restrict"). The header's
  `script-src 'self'` blocked every inline script the meta would have
  hash-permitted. Every page in production fired CSP violations for
  legitimate Astro-emitted inline scripts (`astro-island` runtime, theme
  bootstrap, JSON-LD) and inline `style=""` attributes (Radix UI
  `Select` accessibility shim, React inline styles for progress bars +
  tooltip positioning). The hash-based approach is fundamentally
  incompatible with three things in the stack: Astro v6 doesn't hash
  inline `style="…"` attributes (only `<style>` blocks); Astro's
  `security.csp.directives` whitelist refuses `style-src-attr`,
  `script-src-attr`, etc. (reserved internally); Cloudflare Bot Fight
  Mode injects a per-request beacon (`__CF$cv$params` nonce varies) that
  no build-time hash matches. Fix: disable `security.csp` in
  `astro/astro.config.mjs`; Worker header allows `'unsafe-inline'` for
  `script-src` / `style-src` / `style-src-attr`. XSS prevention now
  rests on React auto-escaping + DOMPurify (markdown render in
  `CodeViewer.tsx`) — which was already doing the actual work. CSP is
  defense-in-depth / policy layer. `SECURITY.md` + `AGENTS.md` updated
  with the 5-reason failure analysis.

- **Atomic `update_paste` RPC — closes burn-resurrection race.**
  `handleUpdatePaste` previously did `findById` (no row lock) → build
  new `Paste` with snapshot `read_count` → `repository.save()` which
  ran `.upsert()`. Two race bugs: (1) concurrent `view_paste`
  increments were clobbered by the stale snapshot; (2) if `view_paste`
  burned (DELETEd) the row between findById and save, the upsert's
  INSERT branch **resurrected the burned paste** with new content and
  `read_count = 0` — defeating burn-after-reading entirely. New
  migration `20260519121514_add_update_paste_rpc.sql` adds
  `update_paste(uuid, uuid, text, text, text)` which takes
  `SELECT ... FOR UPDATE` and applies a partial `UPDATE` with
  `COALESCE(new_x, x)` semantics (NULL arg = leave column unchanged).
  Same SECURITY DEFINER + `service_role`-only grant pattern as
  `delete_paste`. Returns `(was_found, was_updated)`. Touches only
  `content` / `title` / `language` — never `read_count`, `view_limit`,
  `burn_after_reading`, `expires_at`, `visibility`, `version`,
  `is_encrypted`, `delete_token`, or `user_id` (those would invalidate
  the security model if updatable mid-life). New `UpdatePasteCommand` +
  `PasteRepository.updateWithToken()` method + `UpdatePasteSchema` Zod
  schema. `handleUpdatePaste` is now a thin command delegation.
  Production blast radius for the old bug was bounded because no
  frontend calls `PUT /pastes/:id` (verified — only token holders
  hitting the API directly could trigger), but the endpoint itself was
  reachable and broken.

- **`UpdatePasteSchema` Zod validation at the API boundary.** The old
  handler used `parseJsonBody<{token,content,...}>(req)` which is a TS
  cast, not a runtime check. `body.content` could be any type, any
  size — there was no upper bound on the request body, so a
  token-holder could DoS the Worker isolate with a single >128 MiB
  payload. New schema enforces `token` is a UUID, `content` is a string
  ≤25 MiB, `title` ≤100 chars, `language` ≤50 chars; all body fields
  except `token` are optional with "no-change" semantics matching the
  RPC's COALESCE.

- **Rate limits on three previously-unprotected endpoints.**
  `/auth/confirm`, `DELETE|POST /pastes/:id/delete`, `PUT /pastes/:id`,
  and `GET /api/auth/oauth/:provider` had no `rateLimit(...)`
  middleware. Each fires a Supabase round-trip per call → 1:1
  amplification. Reuse existing buckets with distinct scopes:
  `/auth/confirm` and `/api/auth/oauth/:provider` use `RL_AUTH_WRITE`
  (10/60s); delete + update use `RL_PASTE_CREATE` (30/60s). No
  wrangler.jsonc changes — same 4 bindings + 4 namespace IDs.
  `/auth/callback` deliberately not rate-limited (PKCE code is
  single-use, bound to verifier cookie — no amplification possible).

- **`getCookie` URIError exploit (live 500).** `decodeURIComponent`
  throws on malformed percent-escapes (`%E0%A4`, `%2`, lone surrogates,
  etc.). The previous implementation unwrapped the result directly, so
  `Cookie: sb-access-token=%E0%A4` propagated the throw through every
  authenticated route and became HTTP 500 via `app.onError`. Verified
  live before the fix. Now wrapped in try/catch — malformed cookie
  values return null (treated as absent). 4 new regression test cases
  covering different malformation patterns.

### Important — correctness

- **All state-mutating auth calls now use a per-request Supabase
  client.** Initial code review flagged `handleUpdatePassword`'s
  `setSession` as a "latent footgun" — but live smoke testing against
  the deployed 3.9.0 candidate revealed the leak was **actively
  breaking production**, not latent: after ANY successful auth call on
  the shared cached client (`signUp`, `signInWithPassword`,
  `signInWithOtp`, `refreshSession`, `verifyOtp`, `setSession`),
  supabase-js's internal `_saveSession` writes the user's session into
  the GoTrueClient's in-memory storage on the singleton. Subsequent
  outgoing requests from the cached client attach the user's JWT in
  `Authorization`, which overrides the apikey-derived `service_role`
  and makes every following operation execute as `authenticated`. The
  next POST `/pastes` (or any other RLS-bypass write) on the same V8
  isolate fails with `42501 new row violates row-level security policy
  for table "pastes"`. Verified live: a smoke-test login triggered the
  state leak; subsequent POST `/pastes` returned HTTP 500. Initial
  code-review fix touched only `setSession` and left signIn/signUp/
  refreshSession/verifyOtp on the cached client — those 4 paths kept
  the bug alive.

  Comprehensive fix: introduce `AuthHandlers.newClient()` private
  helper returning a fresh per-request `createClient(...)` with
  `persistSession: false`. **All** auth handlers that internally call
  `_saveSession` now route through `newClient()`: `handleSignup`,
  `handleLogin`, `handleMagicLink`, `handleForgotPassword`,
  `handleUpdatePassword`, `handleResendConfirmation`, `handleSession`
  (refresh path), `handleConfirm`. Stateless calls (`getUser(jwt)`,
  `admin.signOut(jwt, scope)`) keep using the cached client because
  they don't touch session storage.

  This was the most severe regression in the 3.9.0 cycle — an active
  production-breaking bug that the code-review verification stage
  rated as latent. Surfaced by running smoke tests after deploy.

- **Zod row validation in `SupabasePasteRepository.mapRow`.** Every row
  field used to be a TypeScript `as` cast. If Supabase returned an
  unexpected shape (schema drift, RLS-stripped column, partial select),
  the cast succeeded and the bug surfaced deep inside the domain layer
  (e.g. `ExpirationPolicy.create(NaN)` throws with no context when
  `created_at` is missing). New `PasteRowSchema` Zod object validates
  every row at the storage boundary with `.passthrough()` so future
  added columns don't break the read path. Failures throw the new
  `RepositoryShapeError` with the Zod issues attached for debugging.

### Internal cleanup

- **Dead code removal.** `cachePasteView` (a throw-only stub from
  3.8.0) was only referenced by its own test; production callers
  always use `preventCaching` per the route-level cache safety comments
  added in 3.8.0. Removed both the function and its test.
  `getDefaultTtl` had zero references anywhere — removed.

### Tests

- **287 unit tests** (was 251). Per-file delta (Vitest grouping — `it.each`
  blocks count as a single test in the per-file total):
  - +22 `UpdatePasteCommand` (new file): schema validation matrix
    covering all field types + execute path (success, NOT_FOUND,
    UNAUTHORIZED, Zod throw on invalid input).
  - +9 `SupabasePasteRepository`: 6 `updateWithToken` (success, partial
    update, not-found, token mismatch, 22P02 invalid UUID, RPC error)
    + 3 `mapRow` Zod validation (missing field, wrong type, passthrough
    of extra columns).
  - +4 `handlers.test.ts` `handleUpdatePaste`: 200 happy path, 404
    not-found, 403 token mismatch, 400 malformed JSON.
  - +1 `authHandlers.test.ts` `handleUpdatePassword` per-request-client
    regression (asserts createClient called twice: constructor + per
    request, second call uses `persistSession: false`).
  - +1 `cookies.test.ts` malformed-cookie regression (one test with 4
    inputs verified via inner loop).
  - −1 `cacheControl.test.ts` (`cachePasteView` test removed alongside
    the function).

### Migrations

- `20260519121514_add_update_paste_rpc.sql` — adds
  `update_paste(uuid, uuid, text, text, text)` SECURITY DEFINER
  PL/pgSQL function with `FOR UPDATE` row lock and partial COALESCE
  update. Granted to `service_role` only. **Must be applied before
  deploying this version** — `PUT /pastes/:id` will 500 until the RPC
  exists in the live DB. Apply via `supabase db push --linked` or
  `pgpasteriser` then deploy with `npm run deploy:prod`.

### Breaking changes

- `PUT /pastes/:id` body now validated by Zod. Non-string content,
  non-UUID tokens, or oversized payloads return 400 `validation_error`
  instead of being silently passed through to the DB. Body fields
  `visibility`, `burnAfterReading`, `viewLimit`, `readCount`, `version`,
  `isEncrypted`, `expiration`, `deleteToken`, and `userId` are dropped
  by the schema (they were never honoured by the old handler either,
  but the surface is now explicit). The frontend doesn't use this
  endpoint, so end-user impact is zero.
- Internal `PasteRepository` interface gained `updateWithToken` method.
  Custom implementations must add it.

### Verification — claims retracted on second pass

- **DDD layer leakage (interface imports `DeleteErrorCode` from
  application).** Initial finding flagged this as a layering violation.
  Retracted: interface → application is the *normal* dependency
  direction in layered DDD architecture, not a violation. No code
  change.
- **Open-redirect attack vector tests missing.** Initial finding said
  only the external-host case was tested. Re-reading
  `authHandlers.test.ts:571-595` showed all 5 attack vectors already
  covered via `it.each([...])`: backslash, protocol-relative,
  fully-qualified URL, `javascript:`, `data:`. No new tests needed.
- **`setSession` shared-client leak severity.** Initial code review
  rated this Important; second-pass verification downgraded it to
  "latent footgun, not active exploit" on the grounds that no read
  path existed. **Re-upgraded to Critical after smoke-test
  verification** — the leak path runs through `_saveSession` (called
  from signUp/signIn/refreshSession/verifyOtp/setSession), not the
  no-arg getSession/getUser. Fix expanded from one call site to all
  state-mutating auth calls (see Important section above). The
  verification process correctly identified the bug class but
  under-estimated which supabase-js methods exercise it.

---

## [3.8.0] - 2026-05-13

Code-review hardening pass. 14 verified findings fixed across security
(burn-after-reading cache bypass, E2EE key leak, DOM-clobbering, plaintext
delete tokens), correctness (SyntaxError → 500, UTF-8 byte counting), and
operational hygiene (shared auth store, visibility-aware polling, single-
statement delete, Supabase grants prep). 251 unit tests (was 224).

### Critical / High — security

- **Cache leak on burn-after-reading + view-limit** [B1]. `GET /pastes/:id` and `GET /p/:slug` JSON responses were emitted with `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`. Browser and downstream shared caches (corporate proxies, ISP caches) could serve the burned content to subsequent viewers within the cache window. The Postgres `view_paste()` function had correctly deleted the row, but the cached response carried it. Both paths now use `preventCaching` (`no-store`). `cachePasteView` in `cacheControl.ts` was converted into a throwing guardrail so callers can't accidentally re-introduce the bug. 5 new tests in `cacheControl.test.ts`.

- **QR code leaked E2EE decryption key to third party** [B2]. `PasteActions.tsx` rendered the QR by sending `encodeURIComponent(window.location.href)` to `api.qrserver.com`. For E2EE pastes the URL fragment `#key=…` was re-encoded as `%23key=…` and landed in the third-party request. Now rendered locally via the `qrcode` npm package (dynamic-imported, skeleton placeholder during load). `api.qrserver.com` removed from CSP `img-src`.

- **"Save password" feature was dead-code that silently never worked** [B3]. `CodeViewer.tsx` wrote `dk:${salt}:${key}` to secureStorage on opt-in but the reader path passed the raw `"dk:..."` string to `decryptData(_, /*isPassword*/ false)`, which tried to base64-decode `"dk:salt:key"` and failed every time. No decoder for the `dk:` prefix existed anywhere. The save modal is removed; users keep typing the password (the only path that ever worked). Reducing the surface area also drops the storage of derived keys, which was a debatable design even when correct.

- **Markdown sanitiser allowed `id`/`class` injection on every element** [B4]. DOMPurify was configured with `SANITIZE_DOM: false` and `SANITIZE_NAMED_PROPS: false` so heading anchors could keep slugged ids. The collateral damage was that any inline `<div id="defaultView">` or `<form name="body">` in a paste's markdown could shadow document-named properties (DOM-clobbering attack vector against any library that resolves globals through the document tree). Both flags restored to their defaults. Heading anchors now travel from the marked renderer as `data-slug="hello-world"` and a DOMPurify `afterSanitizeAttributes` hook hoists the slug to a real `id` only on `<h1>..<h6>` elements. 4 new regression tests: `<div id="defaultView">`, `<form name="body">`, `<input name="cookie">`, and `[click](javascript:alert(1))` neutralisation.

- **Delete tokens stored in plain `localStorage`** [B5]. Six call sites wrote/read `localStorage.setItem('paste_token_<id>', token)`. XSS could enumerate the prefix and delete every paste the user had ever created from that browser. New `pasteTokenStorage` wrapper routes all reads/writes through `secureStorage` (encrypted under a session-scoped master key). Synchronous `hasPasteToken` probe avoids awaiting decryption for the boolean UI state on `PasteActions` mount. Legacy plaintext entries are detected on read and opportunistically migrated forward. **Caveat unchanged**: XSS that can also read `sessionStorage` can still pull the master key and decrypt — the layered defence raises the bar for passive disk-scrape and console-window enumeration but doesn't defeat a real injection.

- **Malformed JSON returned 500 instead of 400** [B6]. `await request.json()` SyntaxError in `handleCreatePaste`, `handleUpdatePaste`, `handleDeletePaste` fell through `rethrowIfZodError` (which only handles errors with an `issues` field) and reached `app.onError` as an unstructured 500. Added `parseJsonBody<T>(request)` helper that catches the parse error and throws `AppError('bad_request', 'Invalid JSON body', 400)`. Delete handler keeps its tolerant catch — a DELETE without a body is a legitimate "I don't have the token" path that the downstream command maps to UNAUTHORIZED.

- **Astro-native CSP with hashes for inline scripts** [B7]. The Worker's `Content-Security-Policy` header previously included `script-src 'self' 'unsafe-inline'` + `style-src 'self' 'unsafe-inline'` because Astro emitted inline `<script set:html={…}>` (theme detection) and inline JSON-LD. Astro 6 `security.csp` is now enabled: every page gets a per-page `<meta http-equiv="content-security-policy">` with SHA-256 hashes for the bundled and inline scripts/styles. The Worker header drops `'unsafe-inline'` — header + meta intersect, so the stricter meta (hashes only, no `'unsafe-inline'`) wins for HTML. Header-only directives (`frame-ancestors`, etc.) stay on the Worker. JSON / API responses still see the tight `script-src 'self'` from the header (no inline scripts in JSON anyway).

- **`getCookie` regex was malformed** [B8]. The character class `/[.*+?^${}()|[\\]\\\\]/g` closed early (after `[\\]`), so the "escape regex metacharacters in the cookie name" replacement matched nothing. Inert in practice — only inputs were `sb-…-token` names containing no metacharacters — but a quiet bug waiting for the day someone added a `.` or `+` to a cookie name. Replaced with the standard `/[-/\\^$*+?.()|[\]{}]/g` pattern. 2 new tests: `a.b+c?` cookie and longest-prefix non-match.

### Important — correctness

- **Validation counted UTF-16 code units, not UTF-8 bytes** [B19]. `createContentSizeRules` checked `value.length <= 25 MB`. Each 4-byte UTF-8 character (emoji, CJK supplementary plane, math symbols) is 2 UTF-16 code units, so an emoji-heavy paste could carry up to 2× the byte limit through the client check then fail server-side as an opaque 500. Now uses `new TextEncoder().encode(value).length`. 6 new tests including a 300k-emoji surrogate-pair regression.

- **Astro structured-data lies** [B18]. The JSON-LD block claimed `url: pasteriser.com` (wrong host — site is `paste.erfi.io`), `AES-GCM` (actual crypto is XSalsa20-Poly1305 via NaCl secretbox), and `Live recent feed via Supabase Realtime` (deleted in migration `20260512102410`). Now driven from `Astro.url.origin` and `description`, with correct algo string and Realtime claim replaced by "Vanity URL slugs".

- **Single-statement atomic delete-with-token** [B20/M20]. `DeletePasteCommand` did `findById` (RT 1) + `delete` (RT 2). Replaced with `deleteWithToken(id, token)` which calls a new `delete_paste(uuid, uuid)` Postgres function: `SELECT ... FOR UPDATE` + comparison + `DELETE` in a single transaction. Returns `(was_found, was_deleted)` so the handler distinguishes 404 / 403 / 200 with one round-trip on the happy path. Migration `20260513170000_add_delete_paste_rpc.sql`. Empty/missing token short-circuits before any DB call. 6 new tests on the repository + 5 on the command.

- **Slug regex tightened** [M7]. Previous regex `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` accepted `a--b`. Replaced with `^[a-z0-9](?:-?[a-z0-9])*$` which rejects consecutive hyphens (DNS-label-style). 4 new Zod tests.

### Important — UX / performance

- **Visibility-aware polling on /recent** [B15]. `RecentPastes.tsx` ran `setInterval(load, 15_000)` regardless of `document.visibilityState`. A user with the tab in the background kept hitting `/api/recent` four times a minute for hours. Now pauses when hidden, resumes + kicks a single fresh fetch on visibility return.

- **Shared `useAuth` store** [B16]. Each of the five `useAuth` consumers (UserMenu, AuthForm, ResetPasswordForm, ForgotPasswordForm, MyPastes) owned its own `useState<AuthState>`. `signIn` in AuthForm didn't propagate to the Header's UserMenu until the latter's own refresh ran (typically via the page navigation after auth). An in-place auth flow would have shown stale state. Refactored to a module-level store + `useSyncExternalStore` — all consumers subscribe to one state. Concurrent `/api/auth/session` calls also deduplicated via `inFlightRefresh`. SSR-safe via `getServerSnapshot`.

- **Astro frontend display URL** [B14]. `PasteForm.tsx` hardcoded `paste.erfi.io/p/` in the vanity-slug prefix label. Replaced with `window.location.origin` so staging / preview / dev display the actual deploy host.

### Operational

- **Supabase Data API grants — Oct 30, 2026 cutover** [SG1/SG2]. Supabase's auto-grant default for new tables in `public` is being revoked. Existing pastes/slugs schema is unaffected. Future migrations must include explicit `GRANT … TO service_role` for every new `public.*` table. Documented in `AGENTS.md` (rule + code snippet) and enforced by `npm run check:migrations` (new), a tsx grep script that flags any `CREATE TABLE public.<name>` without a matching `GRANT … <name> … TO service_role` in the same file. Verified by running against synthetic bad / good migrations.

- **`/api/recent` + `/api/search` cache safety guard** [B10]. Both endpoints emit `Cache-Control: public, max-age=…`. Today they expose only public, non-user-scoped data, but a future change that adds user-scoped filtering would silently leak via shared caches. SAFETY comments added at each route handler enumerating the public-only requirement so future regressions surface in code review.

### Internal cleanup

- **`ConfigurationService` deleted** [M1]. Six-section nested config object whose only consumer was `application.baseUrl`. Replaced with a 16-line `getApplicationBaseUrl(url)` helper. `config.ts` shrunk from 116 lines to 16. The other five getters (`getStorageConfig`, `getSecurityConfig`, `getPasteConfig`, `getLoggingConfig`, plus the dead KV-era settings) had zero call sites.

- **`@typescript-eslint/no-unused-vars` re-enabled** [M22]. Was switched off globally. Re-enabled at `warn` with `argsIgnorePattern: '^_'`. One unused `logger` binding in `/p/:slug` handler removed.

- **Cookie test coverage expanded**. +2 regression tests in `cookies.test.ts` (escape regex metacharacters, longest-prefix non-match).

### Tests

- **251 unit tests** (was 224): +5 cacheControl, +6 deleteWithToken on the repository, +5 deleteWithToken on the command, +4 markdown DOM-clobbering / javascript: href regressions, +6 validation TextEncoder, +4 slug regex tightening, +2 cookie escape regression, +1 SyntaxError → 400, +1 paste-token migration path.
- **25 component tests** unchanged (Astro/jsdom).
- All migrations applied to the linked Supabase project (`dewddkcmwrzbpynylyhg`). 17 migrations total.

### Migrations

- `20260513170000_add_delete_paste_rpc.sql` — adds `delete_paste(uuid, uuid)` SECURITY DEFINER PL/pgSQL function. Granted to `service_role` only. Applied.

### Breaking changes

None at the HTTP API surface. The internal `PasteRepository` interface gained a new method (`deleteWithToken`); add to any custom implementations.

### Verification — claims retracted on second pass

- **SSR/hydration "flash of error" in PasteViewer** (initial review claim) — retracted. `state` initialises to `'loading'` and the SSR + initial client render both emit the loading spinner regardless of pathname value; no hydration mismatch.
- **`view_paste()` two-statement pattern is wasteful** — retracted. Early-exit branches (expired row, view-limit already reached) need the leading `SELECT … FOR UPDATE` so the function can `RETURN` without doing the `UPDATE`. Single-UPDATE refactor would lose those branches.
- **`IS DISTINCT FROM` comment is stale** — retracted. Migration `20260511180117_title_nullable.sql` made `title` nullable; `IS DISTINCT FROM` is now exactly the correct idiom for the trigger WHEN clause.
- **OAuth PKCE client uses service_role key (leak concern)** — retracted. Those `createClient` calls run server-side inside the Worker; the apikey header is on Worker→Supabase HTTP, never reaching the browser.

---

## [3.7.0] - 2026-05-12

Security + scalability hardening pass driven by the
`/home/erfi/supabase/supabase-gripes-research.md` audit. Twelve
confirmed issues fixed across critical / high / medium severity;
two refuted on verification (research was wrong). See
`PLAN-supabase.md` for the per-issue verification log.

### Critical / High — security

- **Rate limiting** [C3]. Implemented via **Cloudflare Workers Rate Limiting bindings** (`[[ratelimits]]` in `wrangler.jsonc`). Four buckets:
  - `RL_AUTH_WRITE` — 10/60s — `POST /api/auth/{signup,login,resend-confirmation,forgot-password,update-password,magic-link}`
  - `RL_SESSION_READ` — 60/60s — `GET /api/auth/session` (closes the stolen-JWT validity oracle)
  - `RL_PASTE_CREATE` — 30/60s — `POST /pastes`
  - `RL_SEARCH` — 30/60s — `GET /api/search`

  Per-IP keying via `CF-Connecting-IP` → `X-Forwarded-For[0]` → `'unknown'`. Per-endpoint scope so each endpoint has its own bucket. Over-limit returns 429 + `Retry-After: 60` + structured `{ "error": { "code": "rate_limited", "message": "..." } }`. Middleware fails open on binding error and no-ops with a debug log when the binding is undefined (vitest, local Astro dev). Implementation: `src/interfaces/api/rateLimit.ts` (7 unit tests). `SECURITY.md` rewrite removes the false claim of a per-IP in-memory cache that never existed.

- **Open redirect on `/auth/confirm?next=…`** [H1]. The previous check `next.startsWith('/') && !next.startsWith('//')` blocked `//evil.com/` but missed the WHATWG-backslash bypass: `new URL('/\\evil.com', 'https://paste.erfi.io')` resolves to `'https://evil.com/'` (the URL parser maps `\` to `/` for special schemes). Replaced with origin-equality post-parse: construct the candidate URL with the request as base, assert `candidate.origin === request.origin`, fall back to `/` otherwise. 5 new tests covering backslash, protocol-relative, fully-qualified URL, `javascript:`, and `data:` schemes.

- **Delete-token leakage via query string + request logger** [H2/M1]. `?token=…` was previously accepted on `DELETE /pastes/:id/delete`. The global request logger emits `Object.fromEntries(url.searchParams)` so the token landed in Cloudflare logpush, browser history, and `Referer` headers. Fix: handler now rejects any `?token=` with HTTP 400 `token_in_query`; token must arrive in the JSON request body. Logger redacts five sensitive query keys: `token`, `token_hash`, `code`, `access_token`, `refresh_token` (allowlist-style — add never remove). `scripts/smoke-test.ts` updated to use body-only deletion.

- **`delete_token` null-guard inverted** [C4]. `if (storedToken && storedToken !== ownerToken)` short-circuited on a falsy stored token, falling through to delete. Inverted to `if (!storedToken || storedToken !== ownerToken)`. The DB schema already enforces `delete_token uuid NOT NULL DEFAULT gen_random_uuid()` so real-world exploitability was ~zero, but the handler is now defense-in-depth correct. 2 new regression tests (undefined token, empty string).

- **`language` field unbounded → GIN-index bloat** [H4]. `language: z.string().optional()` accepted arbitrary-length strings that fed into the `search_vector` generated tsvector + GIN index. Capped at 50 chars. 1 new test.

- **`password` field on the server-side Zod schema** [M5]. The `password` field was accepted at `POST /pastes` and used purely as a "this is encrypted" signal (`if (validParams.password) validParams.isEncrypted = true`). It crossed the Worker in plaintext for no real purpose. Removed from the schema; clients now signal encryption explicitly via `isEncrypted: true`. The frontend was already sending `isEncrypted` correctly. 1 new test.

- **Slug TOCTOU → 500 with raw Postgres error** [M6]. Two concurrent creates with the same custom slug both passed the `resolveSlug` precheck; the race loser hit the unique constraint on `slugs.slug` and threw `Failed to save slug: duplicate key value violates unique constraint…` which propagated as 500. Now `saveSlug` catches Postgres error code `23505` and throws a typed `SlugTakenError`; `CreatePasteCommand` translates that into `AppError('slug_taken', '...', 409)`. 2 new tests (precheck hit, race loser).

- **`secureStorage` master key co-located with ciphertext** [H5]. Per-paste decryption keys (cached for returning users) are encrypted under a master key. The master key was in the same `localStorage` it "protected" — XSS or disk-scrape recovered key + values simultaneously. Moved the master key to `sessionStorage` (tab-scoped, cleared on close). Persistence window shortened from "forever" to "until tab close". Legacy localStorage-resident keys are migrated to sessionStorage on first access. **This does NOT defend against XSS** — `SECURITY.md` updated with the honest threat model.

- **pg-cron expiry DELETEs unbatched** [H6]. Both cron jobs ran `DELETE FROM … WHERE expires_at < now()` with no `LIMIT`. A spike of 1-hour pastes expiring in one window (50k+ rows) held row locks across the entire matching set; concurrent `view_paste(uuid)` calls stalled. Migration `20260512102704_batch_expiry_cleanup.sql` reschedules both with `DELETE … WHERE id IN (SELECT id FROM … LIMIT 1000)`. Lock-hold time bounded by 1000 rows; backlog spreads across cycles. Slug cleanup bumped from daily 03:00 to every 15min to amortise. Applied to remote.

### Medium

- **`/api/my` keyset pagination** [M2]. Previously hard-capped at 100 results with no cursor. Now accepts `?cursor=<iso-timestamp>&limit=<n>` (max 100). Asks Supabase for `limit + 1` to detect "more available" without a second roundtrip. Response includes `nextCursor: string | null`. Bad cursor returns HTTP 400 `bad_cursor`. Frontend `MyPastes.tsx` adds a "Load more" button when `nextCursor` is non-null. 5 new tests cover happy path, cursor filter, malformed cursor, and the `limit+1` probe.

### Architecture — performance

- **Supabase client caching** [A1]. Three call sites in the Worker (`SupabasePasteRepository`, `AuthService`, `AuthHandlers`) used to invoke `createClient(...)` on every request. Each call sets up a fetch wrapper, parses URLs, allocates headers, instantiates a GoTrueClient. Now all three go through `getServiceRoleClient(url, key)` which memoises by `(url, key)` in a module-level Map. The cached client is stateless given `persistSession: false` + `autoRefreshToken: false`. PKCE-flow clients in `handleOAuthStart`/`handleOAuthCallback` still allocate per-request because they inject a custom storage shim that's not safe to share. `__resetSupabaseClientCache()` is exposed for tests.

### Dead-code removal

- **Realtime broadcast pipeline dropped** [H3]. Migration `20260512102410_drop_realtime_broadcast.sql` removes the `broadcast_public_paste_insert` trigger, the `broadcast_public_paste_insert()` PL/pgSQL function, and the two RLS policies on `realtime.messages`. Verification: `astro/src/` had zero `supabase-js` clients, zero `.channel(...)` calls, zero `.subscribe(...)` calls. The CSP `connect-src 'self'` directive physically blocked WebSocket to `*.supabase.co`. Every public-paste insert was enqueuing a Realtime message with no consumer, burning free-tier quota (2M messages/month). Recent-paste UX is polling-only via `GET /api/recent`.
- **`scripts/verify-realtime.ts` deleted** alongside the trigger. `npm run test:realtime` + `test:realtime:tail` scripts removed from `package.json`. `scripts/run-all-live-tests.ts` no longer includes the realtime suite. AGENTS.md + SUPABASE-MIGRATION.md + README.md updated accordingly.

### Incidental improvement

- **`auth.admin.signOut(jwt, 'global')`** in `handleLogout` — replaced the type-cast hack with the real typed call and added explicit `'global'` scope so the refresh token is revoked across all devices, not just the current session. The research claim that the original call was passing the wrong parameter type was incorrect — `admin.signOut(jwt, scope)` correctly accepts a JWT (used as bearer on POST `/logout`).

### Refuted by verification (research §15 was wrong)

- **[C1]** `handleUpdatePassword` shared-client race. `AuthHandlers` is constructed per-request inside the `*` middleware (`src/index.ts:106`). `this.client` is unique per request. Each `createClient()` returns a fresh GoTrueClient. No cross-request mutation possible.
- **[C2]** `admin.signOut(jwt)` is a bug. Verified in `node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.js` — the signature is `signOut(jwt, scope)` and the implementation posts `/logout` with the JWT as bearer. The non-admin `_signOut` internally calls `admin.signOut(accessToken, scope)`. JWT IS the correct parameter.

### Tests

- **224 unit tests** (was 213): +7 rateLimit middleware, +5 createPasteCommand (H4/M5/M6 ×2), +2 deletePasteCommand (C4 ×2), +5 my-pastes cursor pagination, +5 confirm open-redirect (parametrised), +1 delete handler (H2).
- **25 component tests** unchanged (Astro/jsdom).
- **5 local Playwright tests** unchanged (`e2e/local/*.spec.ts`).
- All migrations applied to the linked Supabase project (`dewddkcmwrzbpynylyhg`). Verified post-apply via `cron.job` and `pg_trigger` queries.

### Migrations

- `20260512102410_drop_realtime_broadcast.sql` — drops trigger + function + 2 RLS policies on `realtime.messages`. Applied.
- `20260512102704_batch_expiry_cleanup.sql` — re-schedules both pg-cron jobs with `LIMIT 1000` batched deletes. Applied.

Total migration count: **16**.

### Breaking changes

- `DELETE /pastes/:id/delete?token=…` now returns HTTP 400. Send token in JSON body instead. The API documentation, `scripts/smoke-test.ts`, and `e2e/paste-lifecycle.spec.ts` are already body-only.
- `password` field at `POST /pastes` is silently dropped by Zod (was: used as encryption flag). Clients must send `isEncrypted: true` explicitly. The frontend already does this.
- `language` at `POST /pastes` capped at 50 chars; longer strings → 400.
- `npm run test:realtime` and `npm run test:realtime:tail` removed. Update CI configs.

---

## [3.6.0] - 2026-05-12

### Auth — recovery + magic-link + GitHub OAuth

- **Password recovery** (`/forgot-password` → email → `/auth/reset-password`). New Worker handlers `handleForgotPassword` (calls `resetPasswordForEmail`) and `handleUpdatePassword` (seeds session via `setSession`, calls `updateUser({ password })`). Recovery email template repointed to `/auth/confirm?type=recovery&next=/auth/reset-password`. New Astro pages `ForgotPasswordForm` + `ResetPasswordForm` + `/forgot-password` route + `/auth/reset-password` route. "Forgot?" link on AuthForm login mode. Live verified end-to-end with a fresh test user: recovery link → `/auth/reset-password` with cookies → POST `/api/auth/update-password` → 200 → login with new password works, old password rejected.
- **Magic-link (passwordless) sign-in**. New Worker handler `handleMagicLink` (calls `signInWithOtp({ email, options: { shouldCreateUser: false } })`). AuthForm now has an "Email me a sign-in link instead" toggle on login mode — swaps to passwordless form, on submit shows the "check your email" panel. Magic-link email template already had `type=magiclink&next=/my` from 3.5.0. Live verified.
- **GitHub OAuth**. Full PKCE-aware OAuth flow implemented in the Worker (no browser supabase-js). `handleOAuthStart` uses a capture-only storage to extract the PKCE verifier from supabase-js, stashes it in a short-lived HttpOnly `sb-pkce-verifier` cookie (SameSite=Lax), 302s to Supabase's `/authorize`. `handleOAuthCallback` reads the cookie, seeds it into a fresh client's storage, calls `exchangeCodeForSession(code)`, sets session cookies, clears the PKCE cookie, 302s to `/my`. "Continue with GitHub" button on AuthForm (login + signup). Supabase Auth config patched to enable the GitHub provider (`external_github_enabled`, `external_github_client_id`, `external_github_secret`). Live verified — same `user_id` returned for email-signup-then-GitHub-OAuth thanks to **automatic identity linking** on verified-email match (`auth.identities` now has 2 rows pointing at the same `auth.users` row).
- **Automatic identity linking**. Documented: default GoTrue behavior auto-links OAuth identities to existing email/password users when both emails are verified. No code change needed; verified live. Manual linking (`security_manual_linking_enabled`) left off (default).

### Email templates

- All 5 production templates (confirmation, recovery, magic_link, invite, email_change) extracted to `supabase/templates/*.html` and referenced from `supabase/config.toml` via `content_path`.
- Recovery template `next=` updated from `/login` to `/auth/reset-password` so users land on the password-reset form after clicking the link.
- 2 notification templates (identity_linked, identity_unlinked) also extracted; toggles default to off (`mailer_notifications_identity_*_enabled: false`) — flip to true in `[auth.email.notification.identity_linked]` to opt in.

### IaC: `supabase config push`

- **Generated `supabase/config.toml`** as the single source of truth for project-level Supabase config (auth, email, SMTP, OAuth providers, rate limits, templates). Secrets live in `.env` via `env(VAR)` substitution; never committed.
- Future config changes happen via `supabase config push` (versioned, reviewable, idempotent) rather than ad-hoc `curl -X PATCH` to the Management API. The Management API is still the only way to **read** live state — there's no `config pull` command.
- Initial push successful — only diff vs. remote: MFA TOTP enroll/verify (true → false; we don't use MFA), email OTP length (8 → 6). All other live state preserved.

### Tests

- 172 unit tests (was 150): +6 forgot/update password, +4 magic-link, +8 OAuth start/callback.
- Live smoke 35/35 after the config push.

### Breaking changes

None.

---

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
