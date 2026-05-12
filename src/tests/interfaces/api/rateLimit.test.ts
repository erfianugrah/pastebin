import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { rateLimit, __test__ } from '../../../interfaces/api/rateLimit';

const { clientKey } = __test__;

// Generic Hono env shape so c.set('logger', …) typechecks in tests.
type TestEnv = { Variables: { logger?: typeof NULL_LOGGER } };

const NULL_LOGGER = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

function makeBinding(success: boolean) {
	return { limit: vi.fn().mockResolvedValue({ success }) };
}

describe('rateLimit middleware', () => {
	it('passes through when the binding is missing (local dev / tests)', async () => {
		const app = new Hono<TestEnv>();
		app.use('*', async (c, next) => {
			c.set('logger', NULL_LOGGER);
			return next();
		});
		app.post('/x', rateLimit('RL_AUTH_WRITE', 'signup'), (c) => c.text('ok'));

		const res = await app.fetch(
			new Request('https://x.test/x', { method: 'POST' }),
			{} /* empty env — binding undefined */,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('ok');
	});

	it('passes through when binding returns success: true', async () => {
		const binding = makeBinding(true);
		const env = { RL_AUTH_WRITE: binding };
		const app = new Hono<TestEnv>();
		app.use('*', async (c, next) => {
			c.set('logger', NULL_LOGGER);
			return next();
		});
		app.post('/x', rateLimit('RL_AUTH_WRITE', 'signup'), (c) => c.text('ok'));

		const res = await app.fetch(
			new Request('https://x.test/x', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
			env,
		);
		expect(res.status).toBe(200);
		expect(binding.limit).toHaveBeenCalledWith({ key: 'signup:1.2.3.4' });
	});

	it('returns 429 with Retry-After when binding returns success: false', async () => {
		const binding = makeBinding(false);
		const env = { RL_AUTH_WRITE: binding };
		const app = new Hono<TestEnv>();
		app.use('*', async (c, next) => {
			c.set('logger', NULL_LOGGER);
			return next();
		});
		app.post('/x', rateLimit('RL_AUTH_WRITE', 'signup'), (c) => c.text('ok'));

		const res = await app.fetch(
			new Request('https://x.test/x', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
			env,
		);
		expect(res.status).toBe(429);
		expect(res.headers.get('Retry-After')).toBe('60');
		const body = (await res.json()) as { error?: { code?: string } };
		expect(body.error?.code).toBe('rate_limited');
	});

	it('fails open if the binding throws', async () => {
		const binding = { limit: vi.fn().mockRejectedValue(new Error('binding down')) };
		const env = { RL_AUTH_WRITE: binding };
		const app = new Hono<TestEnv>();
		app.use('*', async (c, next) => {
			c.set('logger', NULL_LOGGER);
			return next();
		});
		app.post('/x', rateLimit('RL_AUTH_WRITE', 'signup'), (c) => c.text('ok'));

		const res = await app.fetch(
			new Request('https://x.test/x', { method: 'POST', headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
			env,
		);
		expect(res.status).toBe(200);
	});

	it('falls back from CF-Connecting-IP to first X-Forwarded-For token', async () => {
		const binding = makeBinding(true);
		const env = { RL_AUTH_WRITE: binding };
		const app = new Hono<TestEnv>();
		app.use('*', async (c, next) => {
			c.set('logger', NULL_LOGGER);
			return next();
		});
		app.post('/x', rateLimit('RL_AUTH_WRITE', 'signup'), (c) => c.text('ok'));

		await app.fetch(
			new Request('https://x.test/x', { method: 'POST', headers: { 'X-Forwarded-For': '5.6.7.8, 9.10.11.12' } }),
			env,
		);
		expect(binding.limit).toHaveBeenCalledWith({ key: 'signup:5.6.7.8' });
	});

	it('falls back to "unknown" when no IP header is present', async () => {
		const binding = makeBinding(true);
		const env = { RL_AUTH_WRITE: binding };
		const app = new Hono<TestEnv>();
		app.use('*', async (c, next) => {
			c.set('logger', NULL_LOGGER);
			return next();
		});
		app.post('/x', rateLimit('RL_AUTH_WRITE', 'signup'), (c) => c.text('ok'));

		await app.fetch(new Request('https://x.test/x', { method: 'POST' }), env);
		expect(binding.limit).toHaveBeenCalledWith({ key: 'signup:unknown' });
	});

	it('clientKey: CF-Connecting-IP wins over X-Forwarded-For', () => {
		const req = new Request('https://x.test/', {
			headers: { 'CF-Connecting-IP': '1.1.1.1', 'X-Forwarded-For': '9.9.9.9' },
		});
		expect(clientKey(req, 'scope')).toBe('scope:1.1.1.1');
	});
});
