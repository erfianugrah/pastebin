# Live /recent feed via a Durable Object Realtime relay (Path B)

Branch: `feat/realtime-recent-do`. Built loop-gated (`.pi/harness.json`).

## Goal
Live updates on `/recent` when a new public paste is created, WITHOUT breaking
pasteriser's BFF invariant (browser -> Worker -> Supabase only; browser never
holds the Supabase URL/key; CSP stays `connect-src 'self'`; one rate-limit
surface).

## Why a Durable Object (not client-direct)
Supabase Realtime Broadcast is normally browser-direct (`wss://<ref>.supabase.co`
with the anon key). That would expose the anon key + a second surface + relax
the CSP -- all of which pasteriser's `useAuth.ts` BFF design deliberately
forbids. Instead: a **Durable Object holds the upstream Realtime subscription
server-side** and fans out to browsers over a **same-origin** WebSocket. This
is the exact pattern the CF+Supabase reference doc recommends ("if you must
relay, a Durable Object is the right CF primitive"), so pasteriser becomes the
doc's first-party proof.

## Architecture
```
public paste INSERT
  -> DB trigger realtime.send('recent:public','paste_created', metadata)   [migration, reinstated]
  -> Supabase Realtime (Broadcast, private channel)
  -> RecentFeedDO  (singleton) holds ONE upstream WS to Supabase, server-side  [anon key, never sent to browser]
  -> fan-out to N browser WS clients (hibernatable WS API)
  -> browser: wss://paste.erfi.io/api/recent/live  (SAME ORIGIN -> connect-src 'self' preserved)
  -> RecentPastes.tsx prepends the new paste
```

## Feasibility (confirmed via docs)
- CF DO can be a WebSocket CLIENT (outbound) -- `cloudflare/use-websockets.md`.
- Supabase Realtime = plain WS + JSON Phoenix protocol -- `supabase/guides/realtime/protocol.md`. No realtime-js dependency.

### Upstream protocol (v1.0.0, JSON text frames)
- URL: `wss://<ref>.supabase.co/realtime/v1/websocket?apikey=<ANON>&vsn=1.0.0`
- Join (private channel): `{topic:"realtime:recent:public", event:"phx_join", payload:{config:{broadcast:{ack:false,self:false}, presence:{enabled:false}, private:true}, access_token:"<ANON-JWT>"}, ref:"1", join_ref:"1"}`
- Heartbeat every <=25s: `{topic:"phoenix", event:"heartbeat", payload:{}, ref:"N"}`
- Receive: `event:"broadcast"` with `payload.event === "paste_created"`, `payload.payload` = the safe paste metadata (id,title,language,createdAt,expiresAt,readCount,isEncrypted,version).
- Errors: `phx_reply` status error (join rejected), `phx_error`/`phx_close` (rejoin w/ backoff 1s/2s/5s/10s), `system` status error (channel closed).

## Components (loop targets, fenced by writeScope)
1. `src/infrastructure/realtime/phoenixClient.ts` -- pure Phoenix-over-WS client: given a WebSocket-like transport, joins the channel, heartbeats, parses frames, emits typed `PasteCreatedEvent`, rejoins on error. **Unit-tested against fixture frames** (the protocol-doc examples) -- this is the sharp sensor.
2. `src/infrastructure/realtime/recentFeedDurableObject.ts` -- the DO. Accepts browser WS upgrades (hibernatable), lazily opens ONE upstream WS via phoenixClient, fans out `paste_created` to all browser sockets. Unit-tested for fan-out + connection lifecycle.
3. `src/interfaces/api/realtimeHandlers.ts` (or route in index.ts) -- `GET /api/recent/live` upgrades the browser WS and routes it to the singleton DO stub.
4. Frontend `astro/src/components/RecentPastes.tsx` -- open same-origin `wss` to `/api/recent/live`, prepend `paste_created` events to the list, fall back to the existing 15s poll if the socket drops.

## Config (parent-scaffolded, not loop)
- Migration `supabase/migrations/<ts>_reinstate_realtime_recent_feed.sql` -- revert the drop: re-add `broadcast_public_paste_insert()` + trigger + the two `realtime.messages` RLS policies (copied from `20260511132703`, which the drop migration removed).
- `wrangler.jsonc` -- add the DO binding + `migrations` block (`new_sqlite_classes: ["RecentFeedDO"]`), `nodejs_compat` only if needed (aim to avoid), and a `SUPABASE_ANON_KEY` (publishable) secret (server-side only; documented in the JSONC header like the other secrets).
- `src/types.ts` -- add `RECENT_FEED: DurableObjectNamespace` + `SUPABASE_ANON_KEY: string`.

## BFF invariants the change MUST preserve (assert in tests / review)
- Browser opens only a SAME-ORIGIN socket (`/api/recent/live`); no `wss://*.supabase.co` in frontend or CSP.
- The anon key + Supabase URL live only in the Worker/DO env, never shipped to `astro/dist`.
- CSP `connect-src` may add `'self'` websocket (same-origin ws is already allowed by `'self'`) -- NO supabase host.
- Only-safe-metadata is broadcast (trigger already curates; DO must not add fields).

## Loop sensors (see .pi/harness.json)
- build (tsc/wrangler dry), typecheck, unit test (phoenixClient + DO conformance), astro build, e2e (browser-assert: a second tab created a public paste appears in /recent live -- against a dev server).
- writeScope fences the four component paths + tests; config files stay parent-owned.
