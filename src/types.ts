/// <reference types="@cloudflare/workers-types" />

export interface Env {
	/** KV namespace retained for rollback safety; unused when STORAGE_BACKEND=supabase. */
	PASTES: KVNamespace;
	/** Cloudflare Assets binding for the Astro static build. */
	ASSETS: Fetcher;

	// ---- Supabase ----

	/** Project URL, e.g. `https://<ref>.supabase.co`. Public, in wrangler vars. */
	SUPABASE_URL: string;
	/** sb_secret_... (or legacy service_role JWT). Wrangler secret, never in source. */
	SUPABASE_SECRET_KEY: string;
	/** Storage backend selector. Defaults to `supabase` in production. */
	STORAGE_BACKEND?: 'kv' | 'supabase' | 'dual';
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
