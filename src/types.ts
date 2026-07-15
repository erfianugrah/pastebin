/// <reference types="@cloudflare/workers-types" />

export interface Env {
	/** Cloudflare Assets binding for the Astro static build. */
	ASSETS: Fetcher;

	// ---- Supabase ----

	/** Project URL, e.g. `https://<ref>.supabase.co`. Public, in wrangler vars. */
	SUPABASE_URL: string;
	/** sb_secret_... (or legacy service_role JWT). Wrangler secret, never in source. */
	SUPABASE_SECRET_KEY: string;
	/**
	 * Anon key as a JWT with role=anon. NOTE: an `sb_publishable_...` key does
	 * NOT work for the RecentFeedDO Realtime subscription - Supabase Realtime
	 * silently ignores `sb_*` tokens as the private-channel access_token.
	 * Used ONLY inside the RecentFeedDO to authenticate the server-side
	 * upstream WebSocket to Supabase Realtime. Wrangler secret - SERVER-SIDE
	 * ONLY. It is never shipped to `astro/dist` and the browser never sees it:
	 * the BFF invariant means clients only ever open the same-origin
	 * `/api/recent/live` socket. Keep it out of any frontend bundle or CSP.
	 */
	SUPABASE_ANON_KEY: string;

	// ---- Realtime relay (Durable Object) ----

	/**
	 * Singleton Durable Object that holds ONE upstream Supabase Realtime
	 * subscription and fans `paste_created` events out to browser clients over
	 * a same-origin WebSocket (`GET /api/recent/live`). Bound in wrangler.jsonc
	 * (`durable_objects` + a `migrations` block with
	 * `new_sqlite_classes: ["RecentFeedDO"]`).
	 */
	RECENT_FEED: DurableObjectNamespace;

	// ---- Rate limiting (CF Workers Rate Limiting binding) ----
	// All four are declared in wrangler.jsonc `ratelimits[]`. They may be
	// undefined when running outside `wrangler dev` (e.g. unit tests, Astro
	// dev preview) — rate-limit middleware no-ops gracefully in that case.

	/** Auth write paths: signup, login, password recovery, magic link, etc. 10/60s. */
	RL_AUTH_WRITE?: RateLimit;
	/** GET /api/auth/session — guards against stolen-JWT validity probing. 60/60s. */
	RL_SESSION_READ?: RateLimit;
	/** POST /pastes — paste-create flood control. 30/60s. */
	RL_PASTE_CREATE?: RateLimit;
	/** GET /api/search — bounded GIN-index probing. 30/60s. */
	RL_SEARCH?: RateLimit;
	/** GET /api/recent — public-feed scrape resistance. 60/60s (frontend polls ~4/min). */
	RL_RECENT?: RateLimit;
	/**
	 * Generous backstop on the unauthenticated read paths: GET /pastes/:id
	 * (JSON), GET /pastes/raw/:id, GET /api/my, GET /api/stats. Each is a DB
	 * round-trip per request and the view paths additionally mutate state
	 * (view_paste burns + bumps read_count), so an uncapped scraper is the
	 * most expensive abuse vector. Loose by design — 240/60s — so normal
	 * browsing never trips it; it only bounds amplification.
	 */
	RL_VIEW?: RateLimit;
}

// Custom fetch response extending the Response interface
export interface ApiResponse<T = any> extends Response {
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: any;
	};
}

// Configuration types
export interface ExpirationConfig {
	default: number; // in seconds
	options: {
		value: number;
		label: string;
	}[];
}
