import { createMiddleware } from 'hono/factory';

/** Content Security Policy directives.
 *
 * Single-layer header CSP. Astro v6's `security.csp` is disabled (see
 * `astro/astro.config.mjs` for the 5-reason explanation). This header is
 * the sole CSP enforcer on every response — JSON, HTML, static assets.
 *
 * **Why `'unsafe-inline'`** — short version: 3.8.0 tried a two-layer
 * design (this header strict + Astro-emitted hash meta) which broke in
 * production because, per CSP3 / MDN, multiple policies on the same
 * resource compose by **intersection of allowances** ("can only further
 * restrict"). The header's `script-src 'self'` blocked every inline
 * script that the meta would have hash-permitted. Three additional
 * forces locked us out of the hash-based approach entirely:
 *
 *   1. Astro v6 hashes inline `<style>` blocks but NEVER inline
 *      `style="…"` attributes. Radix UI's `Select` accessibility shim
 *      emits two of those (`<span style="pointer-events:none">` plus a
 *      visually-hidden native `<select>`); React renders dynamic inline
 *      styles for PasteForm/CodeViewer progress bars, Tooltip
 *      positioning, RecentPastes stagger animation.
 *   2. Astro's `security.csp.directives` whitelist refuses
 *      `style-src-attr`, `script-src-attr`, `script-src-elem`,
 *      `style-src-elem` — reserved internally. No override possible.
 *   3. Cloudflare Bot Fight Mode injects a per-request beacon
 *      (`__CF$cv$params={r:'...',t:'...'}` nonce varies between
 *      requests). No build-time hash can match.
 *
 * XSS prevention in HTML now relies entirely on React's auto-escaping
 * plus DOMPurify on the single `dangerouslySetInnerHTML` call path
 * (markdown render in `CodeViewer.tsx`) — both were already carrying the
 * actual load. CSP here is defense-in-depth / policy.
 *
 * `style-src-attr 'unsafe-inline'` is set explicitly so that future
 * browsers / agents that split `style-src` into `style-src-elem` +
 * `style-src-attr` see the correct allowance for the React inline-style
 * cases above.
 *
 * Header-only directives kept tight: `frame-ancestors 'none'`,
 * `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
 * `connect-src 'self'` — all of which the meta-tag approach also
 * supported but which now consolidate here.
 *
 * `api.qrserver.com` was removed from `img-src` in 3.8.0 when QR
 * rendering moved client-side via the `qrcode` package.
 */
const CSP_DIRECTIVES = [
	"default-src 'self'",
	// See file-level comment. Cannot meaningfully tighten without
	// disabling Cloudflare Bot Fight Mode + replacing Radix UI + giving
	// up React render-time inline styles.
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"style-src-attr 'unsafe-inline'",
	"connect-src 'self'",
	"img-src 'self' data: blob:",
	"font-src 'self'",
	"object-src 'none'",
	"media-src 'self'",
	"worker-src 'self' blob:",
	"child-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"form-action 'self'",
].join('; ');

/**
 * Hono middleware that adds security headers to every response.
 */
export const securityHeaders = createMiddleware(async (c, next) => {
	await next();

	// Clone the response so we can safely mutate headers
	const original = c.res;
	const headers = new Headers(original.headers);

	headers.set('Content-Security-Policy', CSP_DIRECTIVES);
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-XSS-Protection', '1; mode=block');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
	headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

	c.res = new Response(original.body, {
		status: original.status,
		statusText: original.statusText,
		headers,
	});
});
