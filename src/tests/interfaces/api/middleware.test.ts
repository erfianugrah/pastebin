import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { securityHeaders } from '../../../interfaces/api/middleware';

// Regression guard for the production WebSocket-relay bug: securityHeaders
// re-wrapped every response via `new Response(original.body, ...)`, which
// silently drops the non-standard `webSocket` property Cloudflare needs to
// complete a 101 upgrade. The /api/recent/live socket failed with a 1002
// protocol error in prod until the middleware learned to pass those through.
// (A real 101-status Response can't be constructed in the test runtime -
// undici rejects 1xx - so we exercise the `webSocket`-property branch, which
// is the one that actually fires on the DO's 101 response.)
describe('securityHeaders', () => {
	it('passes a WebSocket-upgrade response through untouched', async () => {
		const app = new Hono();
		app.use('*', securityHeaders);
		const marker = { upgraded: true };
		app.get('/ws', () => {
			const res = new Response(null, { status: 200 });
			(res as unknown as { webSocket: unknown }).webSocket = marker;
			return res;
		});

		const res = await app.fetch(new Request('http://x/ws'));
		// The exact same object (not a re-wrapped clone) must survive.
		expect((res as unknown as { webSocket: unknown }).webSocket).toBe(marker);
		// A pass-through response must NOT have had security headers bolted on.
		expect(res.headers.get('Content-Security-Policy')).toBeNull();
	});

	it('adds security headers to a normal response', async () => {
		const app = new Hono();
		app.use('*', securityHeaders);
		app.get('/', (c) => c.text('ok'));

		const res = await app.fetch(new Request('http://x/'));
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	});
});
