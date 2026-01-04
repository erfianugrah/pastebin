# Environment Isolation Fix

**Branch:** `fix/env-isolation`
**Priority:** 🔴 CRITICAL
**Estimated Effort:** 2-3 hours

## Problem Statement

Production and staging environments are currently sharing the same Cloudflare KV namespace IDs. This creates a critical data isolation issue where staging data is stored alongside production data, potentially causing:

- Data contamination between environments
- Accidental deletion of production data during testing
- Performance issues in production due to staging load
- Security and compliance violations

## Root Cause

`wrangler.jsonc` lines 60-80 (production) and 91-111 (staging) use identical KV namespace IDs:
- PASTES: `7ab6cc1ce0744c119c50554173707600`
- PASTE_LOGS: `8d7f5a1c7bd641ce96f1bcd4a66045e9`
- PASTE_RL: `5a1fb152b29e468f8bcf4b509d6726ed`
- ANALYTICS: `1aac5fa067a74e099245c20afd7d07ff`
- WEBHOOKS: `b3350bd1b44143849b7134fb5c96028f`

## Solution

### Phase 1: Create Staging KV Namespaces

- [ ] Create new KV namespaces for staging environment
  ```bash
  wrangler kv:namespace create "PASTES" --env staging
  wrangler kv:namespace create "PASTE_LOGS" --env staging
  wrangler kv:namespace create "PASTE_RL" --env staging
  wrangler kv:namespace create "ANALYTICS" --env staging
  wrangler kv:namespace create "WEBHOOKS" --env staging
  ```

- [ ] Document the new namespace IDs

### Phase 2: Update Configuration

- [ ] Update `wrangler.jsonc` staging environment section with new namespace IDs
- [ ] Verify that production namespaces remain unchanged
- [ ] Add comments to distinguish production vs staging namespaces

### Phase 3: Validation

- [ ] Deploy to staging with `npm run deploy:staging`
- [ ] Verify staging uses separate namespaces (check Cloudflare dashboard)
- [ ] Test basic operations in staging:
  - [ ] Create a test paste
  - [ ] Retrieve the test paste
  - [ ] Delete the test paste
  - [ ] Verify rate limiting works
- [ ] Verify production is unaffected (no existing data lost)

### Phase 4: Documentation

- [ ] Update README.md with environment setup instructions
- [ ] Document KV namespace management procedures
- [ ] Add troubleshooting section for common issues

## Files to Modify

- `wrangler.jsonc` - Update staging KV namespace IDs
- `README.md` - Add environment setup documentation (if exists)
- Create `docs/ENVIRONMENTS.md` - Detailed environment guide

## Testing Checklist

- [ ] Staging can create/read/delete pastes independently
- [ ] Production data is not visible in staging
- [ ] Staging data is not visible in production
- [ ] Rate limiting works independently in each environment
- [ ] Analytics track separately per environment
- [ ] Webhooks trigger correctly in each environment

## Rollback Plan

If issues occur:
1. Revert `wrangler.jsonc` to previous version
2. Redeploy staging: `npm run deploy:staging`
3. Investigate issues before retrying

## Post-Deployment Verification

- [ ] Monitor staging logs for errors
- [ ] Check Cloudflare dashboard for namespace usage
- [ ] Verify no cross-environment data leakage
- [ ] Update runbook with new namespace information

## Notes

- Keep production namespaces unchanged to avoid disruption
- Staging namespaces can be cleared/reset as needed
- Consider adding namespace prefixes in the future (e.g., `prod-pastes`, `staging-pastes`)

## Status

- [ ] Planning
- [ ] Implementation
- [ ] Testing
- [ ] Code Review
- [ ] Deployed to Staging
- [ ] Verified
- [ ] Ready for Production
