import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-integration tests for the Hono app in src/index.ts. These dispatch
// real requests through app.fetch() so the actual middleware chain (DI →
// CORS → security headers → per-route rateLimit) and route handlers run.
//
// Two heavy dependencies are mocked so no network/DB is touched:
//   - @supabase/supabase-js createClient: makes every repository/auth
//     constructor in the DI middleware inert.
//   - ApiHandlers: stubbed so we control handleGetPaste / handlePasteStats
//     responses and can assert how the routes wrap them (preventCaching,
//     rate-limit scope, etc.) without exercising the command/query layers.

const { mockHandleGetPaste, mockHandlePasteStats } = vi.hoisted(() => ({
	mockHandleGetPaste: vi.fn(),
	mockHandlePasteStats: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn(), auth: {} })),
}));

vi.mock('../interfaces/api/handlers', () => {
	// Must be a real constructor (the DI middleware does `new ApiHandlers(...)`).
	class ApiHandlers {
		handleGetPaste = mockHandleGetPaste;
		handlePasteStats = mockHandlePasteStats;
		handleCreatePaste = vi.fn();
		handleGetRecentPastes = vi.fn();
		handleSearchPastes = vi.fn();
		handleDeletePaste = vi.fn();
		handleUpdatePaste = vi.fn();
	}
	return { ApiHandlers };
});

import app from '../index';

const BASE = 'https://paste.test';

/** Build a minimal Env. Pass rate-limit bindings to exercise the middleware. */
function makeEnv(overrides: Record<string, unknown> = {}) {
	return {
		SUPABASE_URL: 'https://test.supabase.co',
		SUPABASE_SECRET_KEY: 'sb_secret_test',
		ASSETS: { fetch: vi.fn() },
		...overrides,
	} as any;
}

/** A RateLimit binding stub whose .limit() outcome is controllable. */
function makeRateLimit(success = true) {
	return { limit: vi.fn().mockResolvedValue({ success }) };
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

describe('index.ts routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /pastes/raw/:id — H1 uncacheable', () => {
		it('returns the raw content with no-store (never public/max-age)', async () => {
			mockHandleGetPaste.mockResolvedValue(jsonResponse({ content: 'secret-raw-body' }));

			const res = await app.fetch(new Request(`${BASE}/pastes/raw/abc123`), makeEnv());

			expect(res.status).toBe(200);
			expect(await res.text()).toBe('secret-raw-body');
			expect(res.headers.get('Content-Type')).toContain('text/plain');

			const cc = res.headers.get('Cache-Control') ?? '';
			expect(cc).toContain('no-store');
			expect(cc).not.toContain('public');
			expect(cc).not.toContain('max-age=3600');
		});

		it('passes through a non-200 handler response unchanged', async () => {
			mockHandleGetPaste.mockResolvedValue(jsonResponse({ error: { code: 'not_found' } }, 404));

			const res = await app.fetch(new Request(`${BASE}/pastes/raw/missing`), makeEnv());
			expect(res.status).toBe(404);
		});
	});

	describe('GET /pastes/:id (JSON) — uncacheable', () => {
		it('wraps the JSON view in preventCaching', async () => {
			mockHandleGetPaste.mockResolvedValue(jsonResponse({ id: 'abc123', content: 'hi' }));

			const res = await app.fetch(
				new Request(`${BASE}/pastes/abc123`, { headers: { accept: 'application/json' } }),
				makeEnv(),
			);

			expect(res.status).toBe(200);
			expect(res.headers.get('Cache-Control') ?? '').toContain('no-store');
		});
	});

	describe('RL_VIEW middleware wiring', () => {
		it('calls RL_VIEW.limit with the view-raw scope on /pastes/raw/:id', async () => {
			mockHandleGetPaste.mockResolvedValue(jsonResponse({ content: 'x' }));
			const rl = makeRateLimit(true);

			await app.fetch(
				new Request(`${BASE}/pastes/raw/abc`, { headers: { 'CF-Connecting-IP': '9.9.9.9' } }),
				makeEnv({ RL_VIEW: rl }),
			);

			expect(rl.limit).toHaveBeenCalledWith({ key: 'view-raw:9.9.9.9' });
		});

		it('uses the view scope on the JSON /pastes/:id route', async () => {
			mockHandleGetPaste.mockResolvedValue(jsonResponse({ id: 'a', content: 'x' }));
			const rl = makeRateLimit(true);

			await app.fetch(
				new Request(`${BASE}/pastes/abc`, {
					headers: { accept: 'application/json', 'CF-Connecting-IP': '8.8.8.8' },
				}),
				makeEnv({ RL_VIEW: rl }),
			);

			expect(rl.limit).toHaveBeenCalledWith({ key: 'view:8.8.8.8' });
		});

		it('uses the stats scope on /api/stats', async () => {
			mockHandlePasteStats.mockResolvedValue(jsonResponse({ total: 0 }));
			const rl = makeRateLimit(true);

			await app.fetch(
				new Request(`${BASE}/api/stats`, { headers: { 'CF-Connecting-IP': '7.7.7.7' } }),
				makeEnv({ RL_VIEW: rl }),
			);

			expect(rl.limit).toHaveBeenCalledWith({ key: 'stats:7.7.7.7' });
		});

		it('returns 429 + Retry-After when RL_VIEW denies the request', async () => {
			mockHandleGetPaste.mockResolvedValue(jsonResponse({ content: 'x' }));
			const rl = makeRateLimit(false);

			const res = await app.fetch(
				new Request(`${BASE}/pastes/raw/abc`, { headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
				makeEnv({ RL_VIEW: rl }),
			);

			expect(res.status).toBe(429);
			expect(res.headers.get('Retry-After')).toBe('60');
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe('rate_limited');
			// The handler must NOT have run when the limiter blocked the request.
			expect(mockHandleGetPaste).not.toHaveBeenCalled();
		});

		it('fails open (serves the request) when the binding is absent', async () => {
			mockHandleGetPaste.mockResolvedValue(jsonResponse({ content: 'x' }));

			const res = await app.fetch(new Request(`${BASE}/pastes/raw/abc`), makeEnv());
			expect(res.status).toBe(200);
			expect(mockHandleGetPaste).toHaveBeenCalled();
		});
	});
});
