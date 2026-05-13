/**
 * Cookie helpers for HttpOnly session cookies.
 *
 * Pasteriser uses two cookies per session:
 *   - sb-access-token: short-lived (1h default per Supabase JWT TTL),
 *     used for getUser() validation on every authenticated request
 *   - sb-refresh-token: long-lived (configurable in Supabase),
 *     used to mint a new access_token when the current one expires
 *
 * Both are HttpOnly so JS can't read them. Secure so they only ride
 * over TLS. SameSite=Strict so they're not sent on cross-site requests
 * (defense against CSRF; browser doesn't include them in form posts
 * from other origins).
 */

export const ACCESS_TOKEN_COOKIE = 'sb-access-token';
export const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';

/** Default access-token TTL in seconds. Supabase JWT exp is typically 1h. */
const ACCESS_MAX_AGE = 60 * 60;
/** Default refresh-token TTL. 7 days is conservative. */
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

interface CookieOpts {
	/** Override the default Max-Age. Pass 0 to clear the cookie. */
	maxAge?: number;
	/** Override Path (default `/`). */
	path?: string;
}

/**
 * Build a Set-Cookie header value. Always HttpOnly + Secure + SameSite=Strict.
 */
function buildCookie(name: string, value: string, opts: CookieOpts = {}): string {
	const maxAge = opts.maxAge ?? ACCESS_MAX_AGE;
	const path = opts.path ?? '/';
	return [
		`${name}=${encodeURIComponent(value)}`,
		`Path=${path}`,
		`Max-Age=${maxAge}`,
		'HttpOnly',
		'Secure',
		'SameSite=Strict',
	].join('; ');
}

/**
 * Returns an object containing two Set-Cookie header values, ready for
 * `response.headers.append('Set-Cookie', ...)` (twice).
 */
export function buildSessionCookies(accessToken: string, refreshToken: string): {
	access: string;
	refresh: string;
} {
	return {
		access: buildCookie(ACCESS_TOKEN_COOKIE, accessToken, { maxAge: ACCESS_MAX_AGE }),
		refresh: buildCookie(REFRESH_TOKEN_COOKIE, refreshToken, { maxAge: REFRESH_MAX_AGE }),
	};
}

/**
 * Build Set-Cookie headers that clear the session cookies (Max-Age=0).
 */
export function buildClearSessionCookies(): { access: string; refresh: string } {
	return {
		access: buildCookie(ACCESS_TOKEN_COOKIE, '', { maxAge: 0 }),
		refresh: buildCookie(REFRESH_TOKEN_COOKIE, '', { maxAge: 0 }),
	};
}

/**
 * Read a single cookie value from a request's Cookie header. Returns null
 * when missing.
 */
export function getCookie(request: Request, name: string): string | null {
	const header = request.headers.get('Cookie') ?? request.headers.get('cookie');
	if (!header) return null;
	// Escape regex metacharacters in the cookie name. Previous expression
	// `/[.*+?^${}()|[\\]\\\\]/g` closed the character class early (after `[\\`)
	// and matched nothing in practice; inputs today are all `sb-…-token`
	// names so the bug was inert, but the fix is one line.
	const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
	const re = new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`);
	const match = header.match(re);
	return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Apply both session cookies to a response. Useful when login/signup
 * succeeds and we want to set the cookies on the JSON response.
 */
export function applySessionCookies(
	response: Response,
	accessToken: string,
	refreshToken: string,
): Response {
	const { access, refresh } = buildSessionCookies(accessToken, refreshToken);
	const headers = new Headers(response.headers);
	headers.append('Set-Cookie', access);
	headers.append('Set-Cookie', refresh);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * Apply clear-cookie headers to a response. Used by logout.
 */
export function applyClearCookies(response: Response): Response {
	const { access, refresh } = buildClearSessionCookies();
	const headers = new Headers(response.headers);
	headers.append('Set-Cookie', access);
	headers.append('Set-Cookie', refresh);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
