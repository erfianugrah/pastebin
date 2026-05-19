import { describe, it, expect } from 'vitest';
import {
	preventCaching,
	addCacheHeaders,
	cacheStaticAsset,
} from '../../../infrastructure/caching/cacheControl';

describe('cacheControl', () => {
	describe('preventCaching', () => {
		it('sets no-store and clears any prior Cache-Control', () => {
			const base = new Response('x', { headers: { 'Cache-Control': 'public, max-age=999' } });
			const out = preventCaching(base);
			const cc = out.headers.get('Cache-Control') ?? '';
			expect(cc).toContain('no-store');
			expect(cc).not.toMatch(/max-age=999/);
		});

		it('preserves status and body', async () => {
			const base = new Response('{"ok":true}', { status: 201, headers: { 'Content-Type': 'application/json' } });
			const out = preventCaching(base);
			expect(out.status).toBe(201);
			expect(out.headers.get('Content-Type')).toBe('application/json');
			expect(await out.text()).toBe('{"ok":true}');
		});
	});

	describe('addCacheHeaders', () => {
		it('sets public + max-age + stale-while-revalidate by default', () => {
			const base = new Response('x');
			const out = addCacheHeaders(base, { maxAge: 60, staleWhileRevalidate: 300 });
			const cc = out.headers.get('Cache-Control') ?? '';
			expect(cc).toContain('public');
			expect(cc).toContain('max-age=60');
			expect(cc).toContain('stale-while-revalidate=300');
		});
	});

	describe('cacheStaticAsset', () => {
		it('sets long max-age public cache for static assets', () => {
			const base = new Response('body');
			const out = cacheStaticAsset(base, 'js');
			const cc = out.headers.get('Cache-Control') ?? '';
			expect(cc).toContain('public');
			expect(cc).toMatch(/max-age=\d+/);
		});
	});
});
