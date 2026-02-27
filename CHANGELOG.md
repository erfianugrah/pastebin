# Changelog

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
