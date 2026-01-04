# Validation Steps for Environment Isolation Fix

## Configuration Changes Complete ✅

The following changes have been successfully implemented:

- ✅ Created 5 new staging-specific KV namespaces
- ✅ Updated wrangler.jsonc with new staging namespace IDs
- ✅ Added comments to distinguish production vs staging
- ✅ Created comprehensive ENVIRONMENTS.md documentation
- ✅ Pushed fix/env-isolation branch to GitHub

## Manual Validation Required

Due to a TailwindCSS build configuration issue in the worktree (unrelated to this fix), manual validation is needed:

### 1. Deploy to Staging

From the main repository (not worktree):
```bash
cd /home/erfi/pastebin
git fetch origin
git checkout fix/env-isolation
npm run deploy:staging
```

### 2. Verify Staging Uses New Namespaces

Check Cloudflare Dashboard:
- Navigate to Workers KV
- Verify staging worker is using namespaces with "staging-" prefix
- Confirm production worker still uses original namespace IDs

### 3. Test Basic Operations in Staging

**Create a paste:**
```bash
curl -X POST https://paste-staging.erfi.dev/pastes \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Test paste for environment isolation",
    "title": "Test",
    "language": "plaintext",
    "visibility": "public"
  }'
```

**Retrieve the paste:**
```bash
# Use the ID from the create response
curl https://paste-staging.erfi.dev/pastes/{PASTE_ID}
```

**Delete the paste:**
```bash
curl -X DELETE https://paste-staging.erfi.dev/pastes/{PASTE_ID}/delete
```

### 4. Verify Rate Limiting

Make multiple rapid requests:
```bash
for i in {1..15}; do
  curl -X POST https://paste-staging.erfi.dev/pastes \
    -H "Content-Type: application/json" \
    -d '{"content":"Test '$i'","visibility":"public"}';
  sleep 0.1;
done
```

Should see rate limiting after ~10 requests.

### 5. Verify Production Unaffected

**Check production still works:**
```bash
curl https://paste.erfi.dev
```

**Verify production data not in staging:**
- Create a paste in production
- Verify it's NOT visible in staging namespace

### 6. Check Logs

**Staging logs:**
```bash
wrangler tail --env staging
```

**Production logs:**
```bash
wrangler tail --env production
```

Look for:
- No errors related to KV access
- Proper namespace binding
- Successful operations

## Success Criteria

- [ ] Staging deployment succeeds
- [ ] Staging can create/read/delete pastes
- [ ] Staging rate limiting works independently
- [ ] Production continues to work normally
- [ ] No production data visible in staging
- [ ] No staging data visible in production
- [ ] Logs show no KV-related errors

## If Issues Occur

### Rollback Plan

1. Switch back to main branch:
   ```bash
   cd /home/erfi/pastebin
   git checkout main
   ```

2. Redeploy staging:
   ```bash
   npm run deploy:staging
   ```

### Common Issues

**Issue: Namespace not found**
- Verify namespace IDs in wrangler.jsonc match Cloudflare dashboard
- Check binding names are correct

**Issue: Rate limiting not working**
- Verify PASTE_RL namespace is bound correctly
- Check KV operations are writing successfully

**Issue: 500 errors**
- Check logs: `wrangler tail --env staging`
- Verify all 5 namespaces are bound
- Confirm environment variables are set

## Next Steps After Validation

Once validated:

1. Merge to main:
   ```bash
   cd /home/erfi/pastebin
   git checkout main
   git merge fix/env-isolation
   git push origin main
   ```

2. Clean up worktree:
   ```bash
   git worktree remove /home/erfi/pastebin-worktrees/env-isolation
   git branch -d fix/env-isolation
   ```

3. Update CODE_REVIEW_TRACKING.md status to ✅ Complete

## Notes

- This fix is critical for data isolation
- Production namespaces remain unchanged (safe)
- Staging can be freely reset/cleared now
- Monitor both environments for 24 hours after merge
