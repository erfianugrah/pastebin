import { createMiddleware } from 'hono/factory';

/** Content Security Policy directives */
const CSP_DIRECTIVES = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
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
