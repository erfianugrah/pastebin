// ─── Cached Supabase client factory ─────────────────────────────────────
// Three call sites in the Worker (SupabasePasteRepository, AuthService,
// AuthHandlers) all create the same service-role Supabase client with
// the same options on every request. `createClient()` is non-trivial —
// it builds a `fetch` wrapper, parses URLs, allocates HTTP headers, sets
// up an internal GoTrueClient, etc.
//
// Cloudflare Workers reuse an isolate across many requests (V8 isolate
// per colo+script+version). Caching by `(url, key)` lets us amortise the
// setup across requests. The cached client is stateless given the
// `persistSession: false` + `autoRefreshToken: false` flags — no shared
// auth state to leak across requests.
//
// PKCE-flow clients in handleOAuthStart / handleOAuthCallback inject a
// per-request `storage` shim and must NOT be cached. They keep calling
// `createClient` directly.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const cache = new Map<string, SupabaseClient>();

export function getServiceRoleClient(url: string, key: string): SupabaseClient {
	const cacheKey = `${url}::${key}`;
	const cached = cache.get(cacheKey);
	if (cached) return cached;
	const client = createClient(url, key, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
			detectSessionInUrl: false,
		},
	});
	cache.set(cacheKey, client);
	return client;
}

// Reset the cache. Exposed for tests; never called in production code.
export function __resetSupabaseClientCache(): void {
	cache.clear();
}
