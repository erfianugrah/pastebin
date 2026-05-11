import { describe, it, expect } from 'vitest';
import {
	ACCESS_TOKEN_COOKIE,
	REFRESH_TOKEN_COOKIE,
	applyClearCookies,
	applySessionCookies,
	buildClearSessionCookies,
	buildSessionCookies,
	getCookie,
} from '../../../interfaces/api/cookies';

describe('cookies', () => {
	describe('buildSessionCookies', () => {
		it('builds two cookies with all hardening flags', () => {
			const { access, refresh } = buildSessionCookies('access.jwt', 'refresh.jwt');

			for (const cookie of [access, refresh]) {
				expect(cookie).toContain('HttpOnly');
				expect(cookie).toContain('Secure');
				expect(cookie).toContain('SameSite=Strict');
				expect(cookie).toContain('Path=/');
			}
		});

		it('encodes the token value', () => {
			const { access } = buildSessionCookies('a/b=c', 'r/s=t');
			expect(access).toContain(`${ACCESS_TOKEN_COOKIE}=${encodeURIComponent('a/b=c')}`);
		});

		it('sets different max-ages for access (short) vs refresh (long)', () => {
			const { access, refresh } = buildSessionCookies('a', 'r');
			const accessAge = parseInt(/Max-Age=(\d+)/.exec(access)?.[1] ?? '0', 10);
			const refreshAge = parseInt(/Max-Age=(\d+)/.exec(refresh)?.[1] ?? '0', 10);
			expect(accessAge).toBe(60 * 60); // 1h
			expect(refreshAge).toBe(60 * 60 * 24 * 7); // 7d
			expect(refreshAge).toBeGreaterThan(accessAge);
		});
	});

	describe('buildClearSessionCookies', () => {
		it('returns Max-Age=0 cookies for both names', () => {
			const { access, refresh } = buildClearSessionCookies();
			expect(access).toContain('Max-Age=0');
			expect(refresh).toContain('Max-Age=0');
			expect(access).toContain(`${ACCESS_TOKEN_COOKIE}=`);
			expect(refresh).toContain(`${REFRESH_TOKEN_COOKIE}=`);
		});
	});

	describe('getCookie', () => {
		it('returns null when no Cookie header', () => {
			const req = new Request('https://x.test');
			expect(getCookie(req, 'foo')).toBeNull();
		});

		it('returns null when cookie name missing', () => {
			const req = new Request('https://x.test', {
				headers: { Cookie: 'other=value' },
			});
			expect(getCookie(req, 'foo')).toBeNull();
		});

		it('returns the cookie value, URL-decoded', () => {
			const req = new Request('https://x.test', {
				headers: { Cookie: `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent('a/b=c')}` },
			});
			expect(getCookie(req, ACCESS_TOKEN_COOKIE)).toBe('a/b=c');
		});

		it('handles multiple cookies and picks the right one', () => {
			const req = new Request('https://x.test', {
				headers: { Cookie: `theme=dark; ${ACCESS_TOKEN_COOKIE}=jwt-value; foo=bar` },
			});
			expect(getCookie(req, ACCESS_TOKEN_COOKIE)).toBe('jwt-value');
			expect(getCookie(req, 'theme')).toBe('dark');
			expect(getCookie(req, 'foo')).toBe('bar');
		});

		it('accepts lowercase cookie header name', () => {
			const req = new Request('https://x.test', {
				headers: { cookie: 'foo=lower-case' },
			});
			expect(getCookie(req, 'foo')).toBe('lower-case');
		});
	});

	describe('applySessionCookies', () => {
		it('adds two Set-Cookie headers without dropping body or status', () => {
			const base = new Response('{"ok":true}', {
				status: 201,
				headers: { 'Content-Type': 'application/json' },
			});
			const res = applySessionCookies(base, 'a.jwt', 'r.jwt');

			expect(res.status).toBe(201);
			expect(res.headers.get('Content-Type')).toBe('application/json');
			const cookies = res.headers.getSetCookie?.() ?? [];
			expect(cookies.length).toBe(2);
			expect(cookies.some((c) => c.includes(ACCESS_TOKEN_COOKIE))).toBe(true);
			expect(cookies.some((c) => c.includes(REFRESH_TOKEN_COOKIE))).toBe(true);
		});
	});

	describe('applyClearCookies', () => {
		it('adds two clear cookies with Max-Age=0', () => {
			const base = new Response('{"ok":true}', { status: 200 });
			const res = applyClearCookies(base);

			const cookies = res.headers.getSetCookie?.() ?? [];
			expect(cookies.length).toBe(2);
			for (const c of cookies) {
				expect(c).toContain('Max-Age=0');
			}
		});
	});
});
