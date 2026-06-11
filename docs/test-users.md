# Test Users

Two pre-confirmed seed accounts on production (`paste.erfi.io`). Created via the
Supabase Admin API (`email_confirm: true`) — no email verification required.

---

## Alice

| Field | Value |
|---|---|
| Email | `seed+alice@erfi.io` |
| Password | *(see 1Password — "Pasteriser seed+alice")* |
| Supabase UID | `35a5da85-7376-4cce-984c-f310fbf02221` |

### Pastes

| Title | Language | Visibility | Special | Expires | ID |
|---|---|---|---|---|---|
| Hono starter | TypeScript | public | — | 2026-07-11 | `3eb60a28-62aa-444d-bb63-8eccafb62076` |
| httpx async fetch | Python | **private** | — | 2026-07-11 | `b08d0691-9cc1-4386-93c1-e37019be3b4e` |
| Slow query check | SQL | public | **burn-after-reading** | 2026-06-18 | `5593a4d9-3398-48e6-8517-c31e62fc3201` |
| Graceful shutdown (Go) | Go | public | **view limit 5** | 2026-06-25 | `f8dfa29c-7e67-4fed-a3c6-94c41852759e` |

---

## Bob

| Field | Value |
|---|---|
| Email | `seed+bob@erfi.io` |
| Password | *(see 1Password — "Pasteriser seed+bob")* |
| Supabase UID | `cf898186-10a6-47ec-b833-3587322e7574` |

### Pastes

| Title | Language | Visibility | Special | Expires | ID |
|---|---|---|---|---|---|
| Postgres backup to R2 | Bash | public | — | 2026-07-11 | `2cb76296-4b84-4d01-83a1-585f763029fd` |
| Node multi-stage Dockerfile | Docker | public | — | 2026-07-11 | `09e05a96-4a77-4fb6-b859-0d6d06e7a298` |
| Pastebin backlog | *(none)* | **private** | — | 2026-08-10 | `d572418f-dc50-4385-81ce-9baf31369b6f` |
| tsconfig strict | JSON | public | **expires 2026-06-12** | 2026-06-12 | `bacd7e98-b28c-45d8-be9b-5f729f471279` |

---

## What each account exercises

| Scenario | How to test |
|---|---|
| Login + session | Sign in as either user, check `/my` shows only their own pastes |
| Private paste isolation | Alice's `httpx async fetch` must 404 when fetched as Bob or anonymous |
| Burn-after-reading | View Alice's `Slow query check` once — second request must 404 |
| View limit | View Alice's `Graceful shutdown (Go)` 5 times — 6th must 404 |
| Short-expiry cleanup | Bob's `tsconfig strict` expires 2026-06-12 — verify cron deletes it |
| Cross-user update/delete | Bob cannot delete/update Alice's pastes (token mismatch → 403) |
| Anonymous public feed | Both users' public pastes appear on the landing page without login |
| Untitled / no language | Bob's `Pastebin backlog` has `title` set but `language = null` |

---

## Re-creating users

If the accounts are deleted or the DB is wiped, recreate with:

```bash
source ~/pastebin/.env

curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"seed+alice@erfi.io","password":"<password>","email_confirm":true}'

curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "Authorization: Bearer $SUPABASE_SECRET_KEY" \
  -H "apikey: $SUPABASE_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"seed+bob@erfi.io","password":"<password>","email_confirm":true}'
```

Then re-run the seed INSERT block from `docs/sql-dashboard.md` query #13 (paste lookup)
or restore from a DB snapshot. Paste IDs above will differ after a re-seed.
