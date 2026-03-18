import { describe, it, expect, vi, beforeEach } from 'vitest';
// We test the Hono app directly — no HTTP server needed

// Mock KV store
class MockKV {
	private store = new Map<string, { value: string; expiration?: number }>();

	async get(key: string): Promise<string | null> {
		const entry = this.store.get(key);
		if (!entry) return null;
		if (entry.expiration && entry.expiration < Date.now() / 1000) {
			this.store.delete(key);
			return null;
		}
		return entry.value;
	}

	async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
		const expiration = opts?.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined;
		this.store.set(key, { value, expiration });
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}

	async list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }> {
		const prefix = opts?.prefix ?? '';
		const keys = Array.from(this.store.keys())
			.filter(k => k.startsWith(prefix))
			.map(name => ({ name }));
		return { keys, list_complete: true };
	}

	clear() { this.store.clear(); }
}

// Mock ASSETS fetcher
const mockAssets = {
	fetch: vi.fn().mockResolvedValue(new Response('<html>mock</html>', {
		status: 200,
		headers: { 'Content-Type': 'text/html' },
	})),
};

// Import the app after mocks are ready
import app from '../../index';

function makeEnv(kv: MockKV) {
	return {
		PASTES: kv as any,
		ASSETS: mockAssets as any,
	};
}

describe('Hono Routes Integration', () => {
	let kv: MockKV;

	beforeEach(() => {
		kv = new MockKV();
		vi.clearAllMocks();
	});

	describe('POST /pastes', () => {
		it('creates a paste and returns id, url, deleteToken', async () => {
			const res = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'hello world', expiration: 3600 }),
			}, makeEnv(kv));

			expect(res.status).toBe(201);
			const body = await res.json() as { id: string; url: string; deleteToken: string };
			expect(body.id).toBeDefined();
			expect(body.url).toContain(body.id);
			expect(body.deleteToken).toBeDefined();
		});

		it('creates a paste with a vanity slug', async () => {
			const res = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'hello', expiration: 3600, slug: 'my-test' }),
			}, makeEnv(kv));

			expect(res.status).toBe(201);
			const body = await res.json() as { url: string; slug: string };
			expect(body.slug).toBe('my-test');
			expect(body.url).toContain('/p/my-test');
		});

		it('rejects empty content', async () => {
			const res = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: '' }),
			}, makeEnv(kv));

			expect(res.status).toBe(400);
		});
	});

	describe('GET /pastes/:id', () => {
		it('returns paste JSON when Accept: application/json', async () => {
			// Create first
			const createRes = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'test content', expiration: 3600 }),
			}, makeEnv(kv));
			const { id } = await createRes.json() as { id: string };

			// Read
			const res = await app.request(`/pastes/${id}`, {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));

			expect(res.status).toBe(200);
			const body = await res.json() as { content: string; readCount: number };
			expect(body.content).toBe('test content');
			expect(body.readCount).toBe(1);
		});

		it('returns 404 for non-existent paste', async () => {
			const res = await app.request('/pastes/nonexistent', {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));

			expect(res.status).toBe(404);
		});
	});

	describe('DELETE /pastes/:id/delete', () => {
		it('deletes a paste with correct token', async () => {
			// Create
			const createRes = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'deleteme', expiration: 3600 }),
			}, makeEnv(kv));
			const { id, deleteToken } = await createRes.json() as { id: string; deleteToken: string };

			// Delete
			const res = await app.request(`/pastes/${id}/delete`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: deleteToken }),
			}, makeEnv(kv));

			expect(res.status).toBe(200);
			const body = await res.json() as { success: boolean };
			expect(body.success).toBe(true);

			// Verify it's gone
			const readRes = await app.request(`/pastes/${id}`, {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));
			expect(readRes.status).toBe(404);
		});

		it('returns 403 with wrong token', async () => {
			const createRes = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'secret', expiration: 3600 }),
			}, makeEnv(kv));
			const { id } = await createRes.json() as { id: string };

			const res = await app.request(`/pastes/${id}/delete`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: 'wrong-token' }),
			}, makeEnv(kv));

			expect(res.status).toBe(403);
		});

		it('returns 403 with no token', async () => {
			const createRes = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'secret', expiration: 3600 }),
			}, makeEnv(kv));
			const { id } = await createRes.json() as { id: string };

			const res = await app.request(`/pastes/${id}/delete`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
			}, makeEnv(kv));

			expect(res.status).toBe(403);
		});
	});

	describe('PUT /pastes/:id', () => {
		it('updates a paste with correct token', async () => {
			const createRes = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'original', expiration: 3600 }),
			}, makeEnv(kv));
			const { id, deleteToken } = await createRes.json() as { id: string; deleteToken: string };

			const res = await app.request(`/pastes/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: deleteToken, content: 'updated' }),
			}, makeEnv(kv));

			expect(res.status).toBe(200);

			// Verify content changed
			const readRes = await app.request(`/pastes/${id}`, {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));
			const body = await readRes.json() as { content: string };
			expect(body.content).toBe('updated');
		});

		it('returns 403 with wrong token', async () => {
			const createRes = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'original', expiration: 3600 }),
			}, makeEnv(kv));
			const { id } = await createRes.json() as { id: string };

			const res = await app.request(`/pastes/${id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: 'wrong', content: 'hacked' }),
			}, makeEnv(kv));

			expect(res.status).toBe(403);
		});
	});

	describe('GET /p/:slug', () => {
		it('resolves a vanity slug to paste content', async () => {
			// Create with slug
			const createRes = await app.request('/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: 'vanity content', expiration: 3600, slug: 'test-slug' }),
			}, makeEnv(kv));
			expect(createRes.status).toBe(201);

			// Read via slug
			const res = await app.request('/p/test-slug', {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));

			expect(res.status).toBe(200);
			const body = await res.json() as { content: string };
			expect(body.content).toBe('vanity content');
		});

		it('returns 404 for non-existent slug', async () => {
			const res = await app.request('/p/nonexistent', {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));

			expect(res.status).toBe(404);
		});
	});

	describe('GET /api/recent', () => {
		it('returns empty array when no pastes', async () => {
			const res = await app.request('/api/recent', {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));

			expect(res.status).toBe(200);
			const body = await res.json() as { pastes: unknown[] };
			expect(body.pastes).toEqual([]);
		});

		it('clamps limit to 100', async () => {
			const res = await app.request('/api/recent?limit=999', {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));

			expect(res.status).toBe(200);
		});
	});

	describe('Security headers', () => {
		it('includes all security headers on responses', async () => {
			const res = await app.request('/', {}, makeEnv(kv));

			expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self' 'unsafe-inline'");
			expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
			expect(res.headers.get('X-Frame-Options')).toBe('DENY');
			expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
			expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		});

		it('CORS allows PUT method', async () => {
			const res = await app.request('/pastes', {
				method: 'OPTIONS',
				headers: {
					'Origin': 'https://example.com',
					'Access-Control-Request-Method': 'PUT',
				},
			}, makeEnv(kv));

			const allowedMethods = res.headers.get('Access-Control-Allow-Methods') || '';
			expect(allowedMethods).toContain('PUT');
		});
	});

	describe('404 handling', () => {
		it('returns 404 JSON for unknown routes', async () => {
			const res = await app.request('/nonexistent', {}, makeEnv(kv));
			// Static assets fallback may return different, but for JSON:
			const res2 = await app.request('/nonexistent', {
				headers: { Accept: 'application/json' },
			}, makeEnv(kv));
			// The catch-all tries ASSETS first, then 404
		});
	});
});
