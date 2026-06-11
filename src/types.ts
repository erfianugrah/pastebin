/// <reference types="@cloudflare/workers-types" />

export interface Env {
	/** Cloudflare Assets binding for the Astro static build. */
	ASSETS: Fetcher;

	// ---- Supabase ----

	/** Project URL, e.g. `https://<ref>.supabase.co`. Public, in wrangler vars. */
	SUPABASE_URL: string;
	/** sb_secret_... (or legacy service_role JWT). Wrangler secret, never in source. */
	SUPABASE_SECRET_KEY: string;

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
