# Changelog

## [Unreleased] - 2025-12-06

### Fixed

#### View Limits & Burn After Reading
- **Incremental Read Count**: View limits now properly increment on every successful read, not just the final view
- **Pre-check Enforcement**: System now checks if view limit is already exceeded before serving content
- **Burn After Reading**: Properly deletes pastes immediately after first view
- **Scheduled Deletion**: When view limit is reached, paste is scheduled for deletion (1 second delay)
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
