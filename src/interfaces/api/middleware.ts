import { createMiddleware } from 'hono/factory';

/** Content Security Policy directives.
 *
 * Two layers of CSP cover the deploy surface:
 *
 *   1. This header (sent on every response).
 *   2. A `<meta http-equiv="content-security-policy">` tag inside every
 *      HTML response, emitted by Astro's `security.csp` feature with
 *      SHA-256 hashes for every bundled / inline script and style.
 *
 * Header and meta are AND-ed by the browser. The meta tag is the more
 * specific of the two (it carries hashes), so it's what actually allows
 * the legitimate inline scripts to run. We removed `'unsafe-inline'` from
 * `script-src` / `style-src` here so the header alone wouldn't let
 * arbitrary inline content through — every inline script must now be
 * hashed by Astro.
 *
 * Header-only directives that `<meta>` cannot express (frame-ancestors,
 * report-uri, report-to, sandbox) stay here.
 *
 * `api.qrserver.com` was previously allowed in `img-src` because QR
 * codes were rendered by sending the URL (including any `#key=…` E2EE
 * fragment) to a third-party generator. The frontend now renders QRs
 * locally with the `qrcode` package, so the third-party host is gone.
 */
const CSP_DIRECTIVES = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self'",
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
