// ─── Rate-limit middleware (Cloudflare Workers Rate Limiting binding) ────
// Backed by per-Worker `[[ratelimits]]` bindings declared in wrangler.jsonc.
// `binding.limit({ key })` returns `{ success: boolean }`; we surface 429
// with `Retry-After` to the client on failure.
//
// The middleware is binding-aware: when the binding is undefined (running
// outside wrangler dev — vitest, Playwright local astro dev — the
// bindings just aren't there) the limit is treated as passed. This keeps
// tests and local frontend dev usable without a stub binding.
//
// Keying — we use the most-stable identifier per request:
//   - Cloudflare-resolved client IP (`CF-Connecting-IP`) is the canonical
//     identifier on a CF Worker. It survives most proxy hops because
//     Cloudflare injects it itself.
//   - For unauthenticated endpoints we additionally compose the path so two
//     different endpoints share a separate bucket per IP.

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../types';
import type { Logger } from '../../infrastructure/logging/logger';

type RateLimitBindingName = 'RL_AUTH_WRITE' | 'RL_SESSION_READ' | 'RL_PASTE_CREATE' | 'RL_SEARCH' | 'RL_RECENT' | 'RL_VIEW';

type RateLimitEnv = {
	Bindings: Env;
	Variables: { logger?: Logger };
};

function clientKey(req: Request, scope: string): string {
	// CF-Connecting-IP is preferred; X-Forwarded-For first-token is the
	// runner-up. Fall back to 'unknown' which buckets all unidentified
	// requests together — still a bucket, just shared.
	const cf = req.headers.get('CF-Connecting-IP');
	const xff = req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
	const ip = cf || xff || 'unknown';
	return `${scope}:${ip}`;
}

/**
 * Hono middleware factory. Given a binding selector and a logical scope
 * (used for keying + 429 body) returns a middleware that gates the next
 * handler on `binding.limit({ key })`.
 *
 * Usage:
 *   app.post('/api/auth/signup', rateLimit('RL_AUTH_WRITE', 'signup'), ...)
 */
export function rateLimit(
	bindingName: RateLimitBindingName,
	scope: string,
): MiddlewareHandler<RateLimitEnv> {
	return async (c, next) => {
		const binding = c.env[bindingName];
		// Local dev / tests: binding absent → pass through. A debug log makes
		// the no-op observable so we don't deploy without rate-limit bindings
		// silently.
		if (!binding) {
			c.get('logger')?.debug?.('rateLimit: binding missing — pass-through', { bindingName });
			return next();
		}

		const key = clientKey(c.req.raw, scope);
		let success = true;
		try {
			const outcome = await binding.limit({ key });
			success = outcome.success;
		} catch (err) {
			// Binding errors should NEVER block real traffic. Log and pass.
			c.get('logger')?.warn?.('rateLimit: binding error — fail-open', { bindingName, err: String(err) });
			return next();
		}

		if (!success) {
			c.get('logger')?.info?.('rateLimit: blocked', { bindingName, scope });
			return c.json(
				{ error: { code: 'rate_limited', message: 'Too many requests. Try again in a minute.' } },
				429,
				{ 'Retry-After': '60' },
			);
		}

		return next();
	};
}

// Exposed for unit tests.
export const __test__ = { clientKey };
