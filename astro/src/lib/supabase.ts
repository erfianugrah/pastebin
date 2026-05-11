/**
 * Browser-side Supabase client (singleton).
 *
 * Lazy-initialised: only created on first access in the browser.
 * Returns null when env vars are missing, so callers can gracefully
 * degrade (no auth UI, no /my page, no live realtime feed).
 *
 * For browser contexts we WANT session persistence and auto-refresh:
 * the session lives in localStorage, auth state survives page reloads,
 * and JWTs get refreshed before they expire.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
	if (_client) return _client;
	if (typeof window === 'undefined') return null; // SSR / build time
	if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;

	_client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
		auth: {
			autoRefreshToken: true,
			persistSession: true,
			detectSessionInUrl: true,
			storageKey: 'pasteriser-auth',
		},
	});

	return _client;
}

export const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
