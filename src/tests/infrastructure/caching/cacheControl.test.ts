import { describe, it, expect } from 'vitest';
import {
	preventCaching,
	addCacheHeaders,
	cachePasteView,
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

	describe('cachePasteView', () => {
		// [B1] Burn-after-reading + view-limit require server-side single-shot.
		// Caching the JSON response would let the original viewer refresh and
		// see burned content (browser cache) and shared caches (corporate
		// proxy, ISP) could serve burned content to subsequent users. The
		// function is now a guardrail that fails loudly on misuse.
		it('throws to prevent accidental caching of paste JSON', () => {
			const base = new Response('x');
			expect(() => cachePasteView(base)).toThrow(/burn-after-reading|preventCaching/);
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
