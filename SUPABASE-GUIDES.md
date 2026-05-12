# Supabase operational guides

Working reference for Pasteriser. When to use the Dashboard, when to use
the CLI, when to use the Management API. Common workflows (apply a
migration, change auth config, debug a stuck flow). Everything in this
file has been verified against the live `dewddkcmwrzbpynylyhg` project.

For *concepts* (RLS patterns, BFF auth, Path C, etc.) see
`~/supabase/postgres-learnings.md`. This file is **operations only** —
which knob to turn, how to turn it, how to verify it.

---

## The three control planes

You'll touch Supabase config from exactly three places. Pick the right
one each time:

| Plane | Best for | Worst for |
|---|---|---|
| **Dashboard** (`https://supabase.com/dashboard/project/<ref>`) | Reading status (Auth users, Logs, Reports), one-off provider config (GitHub OAuth callback URL — not exposed via API), Studio (browsing tables) | Anything you want to repeat. Click-ops doesn't survive code review. |
| **Supabase CLI** | Migrations (`db push`), config IaC (`config push`), local dev (`start`), secrets (Edge Functions only) | Reading live state — there's no `db pull` or `config pull` |
| **Management API** (`https://api.supabase.com/v1/projects/<ref>/...`) | Reading anything programmatically. Writing settings the CLI doesn't cover (manual_linking, specific JWT claims, etc.). | Migration application — use CLI. |

**Rule of thumb**: write via CLI + config.toml, read via Management API,
fall back to Dashboard only for things that genuinely require the UI
(creating a project, paying for an add-on, setting up a Storage bucket
through a visual editor).

---

## Tokens + auth for the three planes

| Plane | Authenticates via |
|---|---|
| Dashboard | Browser session (login at supabase.com) |
| CLI | `~/.supabase/access-token` (created by `supabase login`) |
| Management API | Same `~/.supabase/access-token` as a `Authorization: Bearer …` header |

The CLI access token is a personal access token scoped to your
Supabase account. It can read + write any project in any org you're a
member of. Don't commit it. Don't ship it in CI without scoping
further (use a project-scoped service-role for runtime calls; reserve
the management token for migrations/admin scripts).

---

## Reading live state (single source of truth)

There's no `supabase config pull`. To inspect what's actually in the
remote project's auth/database/storage config, hit the Management API.
Drop this in `~/.zshrc`:

```bash
sb-config() {
  local ref=${1:-dewddkcmwrzbpynylyhg}
  local tok=$(cat ~/.supabase/access-token)
  for p in auth database storage; do
    echo "===== $p ====="
    curl -s -H "Authorization: Bearer $tok" \
      "https://api.supabase.com/v1/projects/$ref/config/$p" \
      | python3 -m json.tool
  done
}
```

Then `sb-config` dumps every settable knob. Save the output to a file
to diff config changes over time.

For specific subsets:

```bash
# Just auth
curl -s -H "Authorization: Bearer $tok" \
  "https://api.supabase.com/v1/projects/$ref/config/auth" | jq

# Just one auth field
curl -s -H "Authorization: Bearer $tok" \
  "https://api.supabase.com/v1/projects/$ref/config/auth" \
  | jq '{site_url, uri_allow_list, smtp_host, external_github_enabled}'
```

---

## Workflow: apply a schema migration

```bash
# 1. Write the SQL (timestamp prefix sorts lexicographically)
ts=$(date -u +%Y%m%d%H%M%S)
cat > supabase/migrations/${ts}_my_change.sql <<'EOF'
ALTER TABLE pastes ALTER COLUMN title DROP NOT NULL;
EOF

# 2. Apply to remote (linked) project
supabase db push --linked

# 3. Verify it took
psql_via_mgmt_api() {
  local sql="$1"
  curl -s -H "Authorization: Bearer $(cat ~/.supabase/access-token)" \
       -H "Content-Type: application/json" \
       -d "{\"query\":\"$sql\"}" \
       "https://api.supabase.com/v1/projects/dewddkcmwrzbpynylyhg/database/query"
}
psql_via_mgmt_api "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"
```

**Never run DDL via the Management API's `/database/query` endpoint or
via `psql` against the live DB directly.** Migrations must always go
through `supabase/migrations/` + `db push` so the schema_migrations
table stays consistent.

**Reading via `database/query` is fine** — it's read-only-by-convention
(actually it accepts writes, but treat it like a query console).

---

## Workflow: change auth config (the IaC way)

`supabase/config.toml` is the single source of truth for project
config. Edit it, push, verify.

```bash
# 1. Edit supabase/config.toml. Example: bump email rate limit.
#    Change `email_sent = 30` under [auth.rate_limit] to 60.

# 2. Validate locally — `supabase config push --yes` shows a diff
#    against remote and asks for confirmation (--yes skips prompt).
supabase config push --yes
# Output: diff of changed fields, "Remote auth config is up to date" on success.

# 3. Verify with the Management API
sb-config | grep -A2 "rate_limit_email_sent"
```

**Diff output is the only way to preview** — there's no proper
`--dry-run`. Look at the diff carefully; the CLI WILL push if you
say yes.

### Pitfalls

- **Email templates** must point at files (`content_path = "./supabase/templates/x.html"`),
  not inline strings.
- **Secrets** go through `env(VAR_NAME)` substitution from `.env`.
  Example: `pass = "env(RESEND_API_KEY)"`. The CLI reads `.env`
  automatically when you run from the project root.
- **OAuth provider client IDs** are not secrets but typically follow
  the same `env(...)` pattern for portability across environments.
- **`config push` is idempotent** but mostly destructive — fields not
  in config.toml may reset to defaults. Always do a `--dry-run`-style
  diff (push prompts you; just don't confirm if it looks wrong) before
  saying yes.

### Fields you can change via Management API but NOT config.toml

Not every auth knob is in `config.toml`'s schema. Notable ones that
still need a direct `PATCH /v1/projects/{ref}/config/auth`:

- `security_manual_linking_enabled` (toggle for `linkIdentity()` flow)
- `external_url` — locked to `<ref>.supabase.co` unless you've paid for
  Supabase Custom Domains add-on
- `mailer_subjects_*` — email subject lines (the body content_path
  fields ARE in config.toml, but the subjects aren't)

Workaround: PATCH directly, document in code comments why config.toml
can't carry that knob.

---

## Workflow: change an email template

```bash
# 1. Edit the HTML
vim supabase/templates/recovery.html

# 2. Push (config.toml already references it via content_path)
supabase config push --yes

# 3. Verify the live template matches your file
diff <(curl -s -H "Authorization: Bearer $(cat ~/.supabase/access-token)" \
       "https://api.supabase.com/v1/projects/dewddkcmwrzbpynylyhg/config/auth" \
       | jq -r '.mailer_templates_recovery_content') \
     supabase/templates/recovery.html
# Empty diff = templates match.
```

### Template gotcha (THE one to remember)

`{{ .EmailActionType }}` is **not available** on most email contexts
and renders as empty string. **Hardcode the `type=` query param** per
template:

| Template | Hardcoded |
|---|---|
| `confirmation` | `type=signup` |
| `recovery` | `type=recovery` |
| `magic_link` | `type=magiclink` |
| `invite` | `type=invite` |
| `email_change` | `type=email_change` |

Available template variables (verified by GoTrue source + live test):
`{{ .SiteURL }}`, `{{ .TokenHash }}`, `{{ .Token }}` (6-digit OTP),
`{{ .Email }}`, `{{ .NewEmail }}` (email-change only), `{{ .Data }}`
(raw user_metadata), `{{ .ConfirmationURL }}` (Supabase's pre-built
URL — use this only if you DON'T want the Path C custom flow).

---

## Workflow: enable a new OAuth provider

Three places to touch, two of them human-only:

1. **Provider side (Dashboard at provider — GitHub, Google, etc.)**
   - Create an OAuth App with callback `https://<ref>.supabase.co/auth/v1/callback`
   - Get the Client ID + Client Secret
   - These ARE secrets; put them in `.env`

2. **Supabase config (CLI/IaC)**
   ```toml
   [auth.external.github]
   enabled = true
   client_id = "env(GH_OAUTH_CLIENT_ID)"
   secret = "env(GH_OAUTH_CLIENT_SECRET)"
   ```
   Then `supabase config push --yes`.

3. **App side (Worker code)**
   - `handleOAuthStart` already supports `provider=github` via a
     whitelist. To add Google: add `'google'` to the `validProviders`
     set in `src/interfaces/api/authHandlers.ts:handleOAuthStart`.
   - Frontend: add "Continue with Google" button on `AuthForm.tsx`
     calling `/api/auth/oauth/google`.

Verify:

```bash
curl -sI 'https://paste.erfi.io/api/auth/oauth/google' \
  | grep -iE "^(location|set-cookie):"
# Expect: Location: https://<ref>.supabase.co/auth/v1/authorize?provider=google&...
#         Set-Cookie: sb-pkce-verifier=...; HttpOnly; SameSite=Lax
```

---

## Workflow: debug a stuck auth flow

When something fails (e.g. confirm link redirects to `/login?error=...`),
the trace is:

```
Browser → paste.erfi.io/auth/confirm?... → Worker handleConfirm
  → supabase.auth.verifyOtp({ token_hash, type })
  → Supabase Auth API
```

Three places to look:

```bash
# 1. Worker logs (Cloudflare). Tails any console.log + uncaught error.
npx wrangler tail --env production --format pretty

# 2. Supabase Auth logs (Dashboard → Logs → Auth Logs)
#    Filter by `auth_event = 'verify'` for confirm-link issues.
#    Or programmatically via the Management API:
curl -s -H "Authorization: Bearer $(cat ~/.supabase/access-token)" \
  "https://api.supabase.com/v1/projects/dewddkcmwrzbpynylyhg/analytics/endpoints/logs.all?sql=$(jq -rn --arg q "SELECT timestamp, event_message FROM auth_logs WHERE timestamp >= datetime_sub(current_timestamp(), INTERVAL '15 MINUTE') ORDER BY timestamp DESC LIMIT 50" '$q|@uri')"

# 3. Raw email content via Resend
curl -s -H "Authorization: Bearer $RESEND_API_KEY" \
  "https://api.resend.com/emails" \
  | jq '.data[0:3] | .[] | {to, subject, status: .last_event, created_at}'
```

For confirm-link issues specifically: **inspect the actual rendered
HTML** of the email. If `type=` is empty in the link, you used
`{{ .EmailActionType }}` somewhere. If `token_hash=` is empty, you
used `{{ .ConfirmationURL }}` instead of `{{ .TokenHash }}`.

---

## Workflow: verify identity linking after OAuth login

```bash
psql_q() {
  curl -s -H "Authorization: Bearer $(cat ~/.supabase/access-token)" \
       -H "Content-Type: application/json" \
       -d "{\"query\":\"$1\"}" \
       "https://api.supabase.com/v1/projects/dewddkcmwrzbpynylyhg/database/query"
}

# All users + identity counts
psql_q 'SELECT u.id, u.email, count(i.provider) AS identities, array_agg(i.provider) AS providers
        FROM auth.users u LEFT JOIN auth.identities i ON i.user_id = u.id
        GROUP BY u.id, u.email;'

# Specific user's linked identities (with GitHub username if linked)
psql_q "SELECT provider, identity_data->>'email' AS email,
        identity_data->>'email_verified' AS verified,
        identity_data->>'user_name' AS gh_username, created_at
        FROM auth.identities WHERE user_id = 'a8943368-...' ORDER BY created_at;"
```

If a user has two identities pointing at the same `user_id` (one
`provider=email`, one `provider=github`), auto-linking worked.

If a user has two `auth.users` rows (one created via email signup, a
separate one created when they tried OAuth), auto-linking failed
because one of the emails was unverified. Recovery: manually merge
via `linkIdentity()` (requires `security_manual_linking_enabled=true`)
or admin `updateUser({ email })` patches.

---

## When the Dashboard is actually the right answer

Most things can go through CLI or API, but a few are click-ops only:

| Task | Where in Dashboard |
|---|---|
| Pay for a plan add-on (Pro, Custom Domains) | Settings → Billing |
| Set up a Storage bucket with visual policies | Storage → New bucket → Policies tab |
| Create the project itself | Home → New project |
| View Auth logs filtered by IP/email | Logs → Auth Logs |
| Browse table contents quickly (Supabase Studio) | Editor → \<table\> |
| Set up Supabase Custom Domain (CNAME pairing) | Settings → Custom Domains |

Studio's table editor is genuinely useful for ad-hoc reads — faster
than writing a SQL query. Just don't do writes there.

---

## When something breaks: rollback strategies

| Scope | Rollback |
|---|---|
| Migration | Write a new migration that reverses the change. **Don't** delete the migration file or `--reset` the DB. |
| `supabase config push` | Edit `config.toml` back to what it was, `config push` again. There's no `config rollback`. Source-of-truth is the toml in git, so `git revert` + `config push` is the canonical recovery. |
| Email template | Same as above — `git revert` the template file, `config push`. |
| Wrangler deploy | `npx wrangler rollback --env production <version-id>` (version IDs in `wrangler deployments list`). |
| Locked-out auth user | Admin API: `auth.admin.deleteUser(id)` then have them re-signup. Or `updateUser({ password })` if they just forgot password and recovery isn't working. |
| Rate-limit binding outage | Middleware fails open (logs `warn`, passes the request). No action needed — fallback is by design. |
| Misconfigured `[[ratelimits]]` namespace_id collision | Cloudflare rejects the deploy. Edit `wrangler.jsonc` to unique IDs (1001-1004 dev, 2001-2004 prod) and `npm run deploy:prod` again. |

---

## Cheat sheet: the URLs and IDs you need

| What | Value |
|---|---|
| Project ref | `dewddkcmwrzbpynylyhg` |
| Supabase host | `https://dewddkcmwrzbpynylyhg.supabase.co` |
| Region | Frankfurt (`eu-central-1`) |
| App URL | `https://paste.erfi.io` |
| Worker name | `pastebin-prod` |
| Cloudflare zone | `erfi.io` (account "Miau") |
| Resend SMTP | `smtp.resend.com:465` |
| Resend verified domain | `erfi.io` (region eu-west-1) |
| Access token path | `~/.supabase/access-token` |
| Secrets file (gitignored) | `~/pastebin/.env` |

---

## Further reading

- **Concepts** (RLS patterns, BFF auth, Path C, custom SMTP, identity linking, vanity URL options): `~/supabase/postgres-learnings.md`
- **Migration journey** (Phase 0 → 6, what changed when and why): `~/pastebin/SUPABASE-MIGRATION.md`
- **CSA-prep retrospective** (what I'd tell a customer): `~/supabase/CSA-PREP-RETROSPECTIVE.md`
- **Project agent notes** (gotchas + commands for working in the repo): `~/pastebin/AGENTS.md`
