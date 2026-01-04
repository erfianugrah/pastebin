# Environment Management Guide

## Overview

This pastebin application uses separate Cloudflare KV namespaces for staging and production environments to ensure complete data isolation.

## Environments

### Production
- **Domain:** paste.erfi.dev
- **Worker Name:** pastebin-prod
- **Purpose:** Live production environment serving real users

### Staging
- **Domain:** paste-staging.erfi.dev
- **Worker Name:** pastebin-staging
- **Purpose:** Pre-production testing and validation

## KV Namespace Mapping

### Production Namespaces
| Binding | ID | Purpose |
|---------|-----|---------|
| PASTES | `7ab6cc1ce0744c119c50554173707600` | Stores paste content and metadata |
| PASTE_LOGS | `8d7f5a1c7bd641ce96f1bcd4a66045e9` | Application logs |
| PASTE_RL | `5a1fb152b29e468f8bcf4b509d6726ed` | Rate limiting data |
| ANALYTICS | `1aac5fa067a74e099245c20afd7d07ff` | Analytics events |
| WEBHOOKS | `b3350bd1b44143849b7134fb5c96028f` | Webhook configuration |

### Staging Namespaces
| Binding | ID | Purpose |
|---------|-----|---------|
| PASTES | `15f1ade337994f439f7453100bd847ea` | Staging paste content and metadata |
| PASTE_LOGS | `637fa1ffa8194886b8c73fab80536d72` | Staging application logs |
| PASTE_RL | `6226c81b658a44bdae8918d70404654c` | Staging rate limiting data |
| ANALYTICS | `6f12963df3594645984c8189188219d7` | Staging analytics events |
| WEBHOOKS | `c5f2d7da655f4990b01e10297f5b84fd` | Staging webhook configuration |

## Deployment

### Deploy to Staging
```bash
npm run deploy:staging
```

This will:
1. Build the frontend UI (`npm run build:ui`)
2. Deploy to staging environment with staging KV namespaces
3. Deploy to paste-staging.erfi.dev

### Deploy to Production
```bash
npm run deploy:prod
```

This will:
1. Build the frontend UI (`npm run build:ui`)
2. Deploy to production environment with production KV namespaces
3. Deploy to paste.erfi.dev

### Development
```bash
npm run dev:all
```

Runs both frontend and backend in development mode:
- Frontend: http://localhost:3000
- Backend: Wrangler dev server

## Data Isolation

**CRITICAL:** Production and staging use completely separate KV namespaces. This ensures:

- ✅ Staging tests cannot affect production data
- ✅ Production data is never visible in staging
- ✅ Rate limiting works independently per environment
- ✅ Analytics are tracked separately
- ✅ Webhooks trigger independently

## Managing KV Namespaces

### List All Namespaces
```bash
wrangler kv namespace list
```

### Create a New Namespace
```bash
# For staging
wrangler kv namespace create "NAMESPACE_NAME" --env staging

# For production
wrangler kv namespace create "NAMESPACE_NAME" --env production
```

### View Namespace Keys
```bash
# Staging
wrangler kv key list --binding=PASTES --env staging

# Production
wrangler kv key list --binding=PASTES --env production
```

### Get a Value
```bash
# Staging
wrangler kv key get "paste-id" --binding=PASTES --env staging

# Production
wrangler kv key get "paste-id" --binding=PASTES --env production
```

### Delete a Key
```bash
# Staging only (never delete from production without backup)
wrangler kv key delete "paste-id" --binding=PASTES --env staging
```

## Troubleshooting

### Staging Shows Production Data
**Cause:** `wrangler.jsonc` staging environment is using production namespace IDs

**Fix:** Verify staging KV namespace IDs in `wrangler.jsonc` match the staging namespaces listed above

### Cannot Access Staging
**Cause:** DNS not configured or deployment failed

**Fix:**
1. Verify custom domain in Cloudflare dashboard
2. Check deployment status: `wrangler deployments list --env staging`
3. Review logs: `wrangler tail --env staging`

### Rate Limiting Not Working
**Cause:** PASTE_RL namespace not properly configured

**Fix:**
1. Verify PASTE_RL binding exists in `wrangler.jsonc`
2. Check namespace ID matches the correct environment
3. Test rate limiting: make multiple rapid requests

### Namespace Quota Exceeded
**Cause:** Too much data in KV namespace (free tier: 1GB)

**Fix:**
1. Review namespace usage in Cloudflare dashboard
2. Clean up expired pastes
3. Implement data retention policies
4. Consider upgrading to paid tier

## Best Practices

### Testing Changes
1. Always test in staging first
2. Verify all functionality works (create, read, delete, rate limiting)
3. Check logs for errors
4. Test with realistic data volume

### Data Management
1. Regularly clean up staging data
2. Never manually modify production data
3. Use scripts for bulk operations
4. Always backup before destructive operations

### Configuration Changes
1. Review `wrangler.jsonc` changes carefully
2. Verify namespace IDs are correct
3. Test deployment to staging
4. Monitor logs after production deployment

### Security
1. Keep ADMIN_API_KEY secret and rotated regularly
2. Never commit secrets to git
3. Use environment variables for sensitive data
4. Audit access logs regularly

## Monitoring

### Check Deployment Status
```bash
# Staging
wrangler deployments list --env staging

# Production
wrangler deployments list --env production
```

### Tail Logs in Real-Time
```bash
# Staging
wrangler tail --env staging

# Production
wrangler tail --env production
```

### View Analytics
Access the analytics endpoint (requires ADMIN_API_KEY):
```bash
curl -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  https://paste-staging.erfi.dev/api/analytics
```

## Emergency Procedures

### Rollback Production Deployment
```bash
# List recent deployments
wrangler deployments list --env production

# Rollback to previous version
wrangler rollback VERSION_ID --env production
```

### Clear Staging Data
```bash
# List all keys
wrangler kv key list --binding=PASTES --env staging > keys.json

# Delete keys (use with caution)
# Create a script to bulk delete if needed
```

### Restore from Backup
If you have KV backups, use the bulk API:
```bash
wrangler kv bulk put backup.json --binding=PASTES --env production
```

## Support

For issues or questions:
1. Check this documentation first
2. Review application logs
3. Check Cloudflare Workers dashboard
4. Review code and recent changes
5. Open an issue in the repository
