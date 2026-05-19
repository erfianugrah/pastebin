import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __resetSupabaseClientCache } from '../../../infrastructure/supabase/getSupabaseClient';
import { AuthHandlers } from '../../../interfaces/api/authHandlers';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../../../interfaces/api/cookies';
import { Logger } from '../../../infrastructure/logging/logger';

// ---- Supabase client mock ----

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(),
}));

import { createClient } from '@supabase/supabase-js';

const mockLogger = {
	trace: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	fatal: vi.fn(),
	setContext: vi.fn(),
	clearContext: vi.fn(),
} as unknown as Logger;

interface MockAuth {
	signUp?: ReturnType<typeof vi.fn>;
	signInWithPassword?: ReturnType<typeof vi.fn>;
	signInWithOtp?: ReturnType<typeof vi.fn>;
	signInWithOAuth?: ReturnType<typeof vi.fn>;
	exchangeCodeForSession?: ReturnType<typeof vi.fn>;
	getUser?: ReturnType<typeof vi.fn>;
	refreshSession?: ReturnType<typeof vi.fn>;
	verifyOtp?: ReturnType<typeof vi.fn>;
	resend?: ReturnType<typeof vi.fn>;
	resetPasswordForEmail?: ReturnType<typeof vi.fn>;
	updateUser?: ReturnType<typeof vi.fn>;
	setSession?: ReturnType<typeof vi.fn>;
	admin?: { signOut?: ReturnType<typeof vi.fn> };
}

interface MockClient {
	auth: MockAuth;
	from?: ReturnType<typeof vi.fn>;
}

function clientWith(auth: MockAuth, from?: ReturnType<typeof vi.fn>): MockClient {
	return { auth, from };
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
	return new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
}

function getRequest(url: string, headers: Record<string, string> = {}): Request {
	return new Request(url, { headers });
}

function getSetCookies(res: Response): string[] {
	return res.headers.getSetCookie?.() ?? [];
}

beforeEach(() => {
	vi.resetAllMocks();
	// Wipe the (url, key) → SupabaseClient cache so each test's
	// createClient mock is honoured instead of returning the cached
	// instance from a previous test.
	__resetSupabaseClientCache();
});

describe('AuthHandlers', () => {
	describe('handleSignup', () => {
		it('rejects empty body with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const req = new Request('https://x.test/api/auth/signup', {
				method: 'POST',
				body: 'not json',
				headers: { 'Content-Type': 'application/json' },
			});
			const res = await handler.handleSignup(req);
			expect(res.status).toBe(400);
		});

		it('rejects missing email/password with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSignup(
				jsonRequest('https://x.test/api/auth/signup', { email: 'a@b' }),
			);
			expect(res.status).toBe(400);
		});

		it('rejects short passwords with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSignup(
				jsonRequest('https://x.test/api/auth/signup', { email: 'a@b.c', password: 'short' }),
			);
			expect(res.status).toBe(400);
		});

		it('returns needsConfirm without setting cookies when no session yet', async () => {
			const signUp = vi.fn().mockResolvedValue({
				data: { user: { id: 'u1' }, session: null },
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ signUp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSignup(
				jsonRequest('https://x.test/api/auth/signup', {
					email: 'a@b.c',
					password: 'longenough',
				}),
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { needsConfirm: boolean; user: { id: string } };
			expect(body.needsConfirm).toBe(true);
			expect(body.user.id).toBe('u1');
			expect(getSetCookies(res).length).toBe(0);
		});

		it('sets two Set-Cookie headers when signup yields a session', async () => {
			const signUp = vi.fn().mockResolvedValue({
				data: {
					user: { id: 'u2' },
					session: { access_token: 'access.jwt', refresh_token: 'refresh.jwt' },
				},
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ signUp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSignup(
				jsonRequest('https://x.test/api/auth/signup', {
					email: 'a@b.c',
					password: 'longenough',
				}),
			);

			expect(res.status).toBe(200);
			const cookies = getSetCookies(res);
			expect(cookies.length).toBe(2);
			expect(cookies.some((c) => c.includes(ACCESS_TOKEN_COOKIE))).toBe(true);
			expect(cookies.some((c) => c.includes(REFRESH_TOKEN_COOKIE))).toBe(true);
		});

		it('returns 409 email_taken when Supabase returns empty identities (duplicate email)', async () => {
			// Supabase's anti-enumeration response: success-shaped payload
			// with user.identities = [] when the email is already registered.
			const signUp = vi.fn().mockResolvedValue({
				data: {
					user: { id: 'u-existing', email: 'a@b.c', identities: [] },
					session: null,
				},
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ signUp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSignup(
				jsonRequest('https://x.test/api/auth/signup', {
					email: 'a@b.c',
					password: 'longenough',
				}),
			);

			expect(res.status).toBe(409);
			const body = (await res.json()) as { error: { code: string; message: string } };
			expect(body.error.code).toBe('email_taken');
			expect(body.error.message).toMatch(/already exists/i);
			expect(getSetCookies(res).length).toBe(0);
		});

		it('surfaces Supabase signup error as 400', async () => {
			const signUp = vi.fn().mockResolvedValue({
				data: { user: null, session: null },
				error: { code: 'user_already_exists', message: 'User already registered' },
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ signUp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSignup(
				jsonRequest('https://x.test/api/auth/signup', {
					email: 'a@b.c',
					password: 'longenough',
				}),
			);

			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { message: string } };
			expect(body.error.message).toContain('already');
		});
	});

	describe('handleLogin', () => {
		it('sets cookies when password is valid', async () => {
			const signInWithPassword = vi.fn().mockResolvedValue({
				data: {
					user: { id: 'u3' },
					session: { access_token: 'a', refresh_token: 'r' },
				},
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ signInWithPassword }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleLogin(
				jsonRequest('https://x.test/api/auth/login', {
					email: 'a@b.c',
					password: 'right',
				}),
			);

			expect(res.status).toBe(200);
			expect(getSetCookies(res).length).toBe(2);
		});

		it('returns 401 on invalid credentials, no cookies', async () => {
			const signInWithPassword = vi.fn().mockResolvedValue({
				data: { user: null, session: null },
				error: { code: 'invalid_credentials', message: 'Bad password' },
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ signInWithPassword }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleLogin(
				jsonRequest('https://x.test/api/auth/login', {
					email: 'a@b.c',
					password: 'wrong',
				}),
			);

			expect(res.status).toBe(401);
			expect(getSetCookies(res).length).toBe(0);
		});

		it('rejects malformed body with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleLogin(
				new Request('https://x.test/api/auth/login', {
					method: 'POST',
					body: 'not json',
					headers: { 'Content-Type': 'application/json' },
				}),
			);
			expect(res.status).toBe(400);
		});
	});

	describe('handleLogout', () => {
		it('clears cookies even when no session cookie was present', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleLogout(
				new Request('https://x.test/api/auth/logout', { method: 'POST' }),
			);
			expect(res.status).toBe(200);
			const cookies = getSetCookies(res);
			expect(cookies.length).toBe(2);
			expect(cookies.every((c) => c.includes('Max-Age=0'))).toBe(true);
		});
	});

	describe('handleSession', () => {
		it('returns { user: null } when no cookie', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSession(getRequest('https://x.test/api/auth/session'));
			expect(res.status).toBe(200);
			const body = (await res.json()) as { user: null };
			expect(body.user).toBeNull();
		});

		it('returns user when cookie is valid', async () => {
			const getUser = vi.fn().mockResolvedValue({
				data: { user: { id: 'u4', email: 'x@y.com' } },
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSession(
				getRequest('https://x.test/api/auth/session', {
					Cookie: `${ACCESS_TOKEN_COOKIE}=good.jwt`,
				}),
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { user: { id: string } };
			expect(body.user.id).toBe('u4');
			expect(getUser).toHaveBeenCalledWith('good.jwt');
		});

		it('refreshes silently when access token expired but refresh token is valid', async () => {
			const getUser = vi.fn().mockResolvedValue({
				data: { user: null },
				error: { message: 'jwt expired' },
			});
			const refreshSession = vi.fn().mockResolvedValue({
				data: {
					user: { id: 'u5' },
					session: { access_token: 'new.access', refresh_token: 'new.refresh' },
				},
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser, refreshSession }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSession(
				getRequest('https://x.test/api/auth/session', {
					Cookie: `${ACCESS_TOKEN_COOKIE}=expired.jwt; ${REFRESH_TOKEN_COOKIE}=valid.refresh`,
				}),
			);

			expect(refreshSession).toHaveBeenCalledWith({ refresh_token: 'valid.refresh' });
			expect(res.status).toBe(200);
			const body = (await res.json()) as { user: { id: string } };
			expect(body.user.id).toBe('u5');
			expect(getSetCookies(res).length).toBe(2);
		});

		it('clears cookies when both tokens are invalid', async () => {
			const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
			const refreshSession = vi.fn().mockResolvedValue({
				data: { session: null, user: null },
				error: { message: 'refresh failed' },
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser, refreshSession }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleSession(
				getRequest('https://x.test/api/auth/session', {
					Cookie: `${ACCESS_TOKEN_COOKIE}=expired; ${REFRESH_TOKEN_COOKIE}=expired`,
				}),
			);

			const body = (await res.json()) as { user: null };
			expect(body.user).toBeNull();
			expect(getSetCookies(res).every((c) => c.includes('Max-Age=0'))).toBe(true);
		});
	});

	describe('handleMyPastes', () => {
		function withChain(rows: unknown[] | null, error: { message: string } | null = null) {
			// Chain is thenable so `await query` resolves with the terminator
			// regardless of where in the chain the handler stops calling
			// methods. Each method returns the chain itself, including `.limit`
			// — the handler may call `.lt(...)` after `.limit(...)` (cursor
			// path) so `.limit` cannot terminate.
			const result = { data: rows, error };
			const chain: Record<string, any> = {
				select: vi.fn(() => chain),
				eq: vi.fn(() => chain),
				gt: vi.fn(() => chain),
				lt: vi.fn(() => chain),
				order: vi.fn(() => chain),
				limit: vi.fn(() => chain),
				then: (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve),
			};
			return chain;
		}

		it('returns 401 when no session cookie', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMyPastes(getRequest('https://x.test/api/my'));
			expect(res.status).toBe(401);
		});

		it('returns 401 when getUser rejects the cookie', async () => {
			const getUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMyPastes(
				getRequest('https://x.test/api/my', { Cookie: `${ACCESS_TOKEN_COOKIE}=invalid` }),
			);
			expect(res.status).toBe(401);
		});

		it('returns the calling user pastes, filtered server-side', async () => {
			const getUser = vi.fn().mockResolvedValue({
				data: { user: { id: 'user-99' } },
				error: null,
			});
			const chain = withChain([
				{ id: 'p1', title: 'mine', user_id: 'user-99', created_at: '2026-05-12T10:00:00Z' },
			]);
			const from = vi.fn(() => chain);
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }, from) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMyPastes(
				getRequest('https://x.test/api/my', { Cookie: `${ACCESS_TOKEN_COOKIE}=valid` }),
			);

			expect(res.status).toBe(200);
			expect(from).toHaveBeenCalledWith('pastes');
			expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-99');
			const body = (await res.json()) as { pastes: unknown[]; nextCursor: string | null };
			expect(body.pastes).toHaveLength(1);
			expect(body.nextCursor).toBeNull(); // single page, no more
		});

		// [M2] Pagination — handler asks Supabase for limit+1 rows so it knows
		// whether to surface a nextCursor without a second query.
		it('clamps limit to [1, 100] and asks for limit+1 rows for has-more probe', async () => {
			const getUser = vi.fn().mockResolvedValue({
				data: { user: { id: 'user-100' } },
				error: null,
			});
			const chain = withChain([]);
			const from = vi.fn(() => chain);
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }, from) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			await handler.handleMyPastes(
				getRequest('https://x.test/api/my?limit=999', { Cookie: `${ACCESS_TOKEN_COOKIE}=v` }),
			);
			// 999 → clamped to 100, then +1 for the has-more probe
			expect(chain.limit).toHaveBeenCalledWith(101);
		});

		// [M2] nextCursor is the created_at of the LAST returned row (not the
		// extra probe row), and only present when there are more pages.
		it('returns nextCursor when more rows exist beyond the requested limit', async () => {
			const getUser = vi.fn().mockResolvedValue({
				data: { user: { id: 'user-101' } },
				error: null,
			});
			// Limit=2, repository returns 3 rows (probe). The 3rd is dropped;
			// nextCursor = created_at of row 2 (the last RETURNED row).
			const rows = [
				{ id: 'a', created_at: '2026-05-12T10:00:00Z' },
				{ id: 'b', created_at: '2026-05-12T09:00:00Z' },
				{ id: 'c', created_at: '2026-05-12T08:00:00Z' },
			];
			const chain = withChain(rows);
			const from = vi.fn(() => chain);
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }, from) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMyPastes(
				getRequest('https://x.test/api/my?limit=2', { Cookie: `${ACCESS_TOKEN_COOKIE}=v` }),
			);

			const body = (await res.json()) as { pastes: unknown[]; nextCursor: string | null };
			expect(body.pastes).toHaveLength(2);
			expect(body.nextCursor).toBe('2026-05-12T09:00:00Z');
		});

		// [M2] Cursor parameter triggers `.lt('created_at', cursor)` on the
		// query. Bad cursor → 400 instead of silently returning page 1.
		it('passes cursor through as a < filter on created_at', async () => {
			const getUser = vi.fn().mockResolvedValue({
				data: { user: { id: 'user-102' } },
				error: null,
			});
			const chain = withChain([]);
			const from = vi.fn(() => chain);
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }, from) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			await handler.handleMyPastes(
				getRequest('https://x.test/api/my?limit=10&cursor=2026-05-12T09:00:00Z', {
					Cookie: `${ACCESS_TOKEN_COOKIE}=v`,
				}),
			);
			expect(chain.lt).toHaveBeenCalledWith('created_at', '2026-05-12T09:00:00.000Z');
		});

		it('returns 400 on malformed cursor', async () => {
			const getUser = vi.fn().mockResolvedValue({
				data: { user: { id: 'user-103' } },
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMyPastes(
				getRequest('https://x.test/api/my?cursor=not-a-date', { Cookie: `${ACCESS_TOKEN_COOKIE}=v` }),
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error?: { code?: string } };
			expect(body.error?.code).toBe('bad_cursor');
		});
	});

	describe('handleConfirm', () => {
		it('redirects to /login?error=missing_token when token_hash missing', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleConfirm(getRequest('https://x.test/auth/confirm?type=signup'));
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('/login?error=missing_token');
		});

		it('redirects to /login?error=invalid_type for unknown type', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleConfirm(
				getRequest('https://x.test/auth/confirm?token_hash=t&type=evil'),
			);
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('/login?error=invalid_type');
		});

		it('sets cookies and 302s to next on successful verifyOtp', async () => {
			const verifyOtp = vi.fn().mockResolvedValue({
				data: {
					user: { id: 'u9' },
					session: { access_token: 'a.jwt', refresh_token: 'r.jwt' },
				},
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ verifyOtp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleConfirm(
				getRequest('https://x.test/auth/confirm?token_hash=tok&type=signup&next=/my'),
			);

			expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'tok', type: 'signup' });
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toBe('https://x.test/my');
			expect(getSetCookies(res).length).toBe(2);
		});

		it('rejects external-host `next` (defends against open-redirect)', async () => {
			const verifyOtp = vi.fn().mockResolvedValue({
				data: {
					user: { id: 'u10' },
					session: { access_token: 'a', refresh_token: 'r' },
				},
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ verifyOtp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleConfirm(
				getRequest('https://x.test/auth/confirm?token_hash=t&type=signup&next=//evil.com/'),
			);
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toBe('https://x.test/');
		});

		// WHATWG URL parser maps backslashes to forward slashes for special
		// schemes (http/https/etc.). A naive `next.startsWith('/') && !next
		// .startsWith('//')` check passes `'/\evil.com'` (second char is '\',
		// not '/'), but
		//   new URL('/\\evil.com', 'https://x.test') → 'https://evil.com/'
		// — open redirect. The fix validates the *resolved* origin equals the
		// request origin instead of pattern-matching the input string.
		it.each([
			['backslash variant', '/\\evil.com'],
			['protocol-relative', '//evil.com/'],
			['fully-qualified url', 'https://evil.com/'],
			['javascript scheme', 'javascript:alert(1)'],
			['data scheme', 'data:text/html,<script>1</script>'],
		])('rejects malicious next param (%s)', async (_, nextValue) => {
			const verifyOtp = vi.fn().mockResolvedValue({
				data: {
					user: { id: 'u11' },
					session: { access_token: 'a', refresh_token: 'r' },
				},
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ verifyOtp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleConfirm(
				getRequest(`https://x.test/auth/confirm?token_hash=t&type=signup&next=${encodeURIComponent(nextValue)}`),
			);
			expect(res.status).toBe(302);
			// Must redirect on-origin only — never to an attacker-controlled host.
			const loc = res.headers.get('Location') || '';
			expect(new URL(loc).origin).toBe('https://x.test');
		});

		it('302s to /login?error=... when verifyOtp fails', async () => {
			const verifyOtp = vi.fn().mockResolvedValue({
				data: { user: null, session: null },
				error: { code: 'otp_expired', message: 'expired' },
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ verifyOtp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleConfirm(
				getRequest('https://x.test/auth/confirm?token_hash=t&type=signup'),
			);
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('/login?error=otp_expired');
			expect(getSetCookies(res).length).toBe(0);
		});
	});

	describe('handleOAuthStart', () => {
		it('rejects unknown providers with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleOAuthStart(
				getRequest('https://x.test/api/auth/oauth/myspace'),
				'myspace',
			);
			expect(res.status).toBe(400);
		});

		it('302s to Supabase URL + sets PKCE cookie on success', async () => {
			// Mock signInWithOAuth to both return the URL AND write the
			// PKCE verifier through the capture-storage we passed in.
			let storageRef: { setItem: (k: string, v: string) => void } | null = null;
			vi.mocked(createClient).mockImplementation((_url: any, _key: any, opts: any) => {
				storageRef = opts.auth.storage;
				return {
					auth: {
						signInWithOAuth: vi.fn().mockImplementation(async () => {
							// Simulate supabase-js writing the verifier into storage
							// synchronously before returning the URL.
							storageRef!.setItem('sb-x-auth-token-code-verifier', 'verifier-xyz-123');
							return {
								data: { provider: 'github', url: 'https://x.supabase.co/auth/v1/authorize?...' },
								error: null,
							};
						}),
					},
				} as any;
			});

			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);
			const res = await handler.handleOAuthStart(
				getRequest('https://paste.test/api/auth/oauth/github'),
				'github',
			);

			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('supabase.co/auth/v1/authorize');
			const setCookies = res.headers.getSetCookie?.() ?? [];
			const pkce = setCookies.find((c) => c.startsWith('sb-pkce-verifier='));
			expect(pkce).toBeDefined();
			expect(pkce).toContain('verifier-xyz-123');
			expect(pkce).toContain('HttpOnly');
			expect(pkce).toContain('Secure');
			expect(pkce).toContain('SameSite=Lax');
		});

		it('302s to /login?error=... when signInWithOAuth fails', async () => {
			vi.mocked(createClient).mockImplementation(() => ({
				auth: {
					signInWithOAuth: vi.fn().mockResolvedValue({
						data: null,
						error: { code: 'provider_disabled', message: 'github is not enabled' },
					}),
				},
			}) as any);

			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);
			const res = await handler.handleOAuthStart(
				getRequest('https://paste.test/api/auth/oauth/github'),
				'github',
			);

			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('/login?error=provider_disabled');
		});
	});

	describe('handleOAuthCallback', () => {
		it('redirects to /login?error=<error> when provider returns an error', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleOAuthCallback(
				getRequest('https://x.test/auth/callback?error=access_denied'),
			);
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('/login?error=access_denied');
		});

		it('redirects to /login?error=missing_code when no code', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleOAuthCallback(
				getRequest('https://x.test/auth/callback'),
			);
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('/login?error=missing_code');
		});

		it('redirects to /login?error=missing_verifier when PKCE cookie absent', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleOAuthCallback(
				getRequest('https://x.test/auth/callback?code=abc'),
			);
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('/login?error=missing_verifier');
		});

		it('sets session cookies + 302s to /my on successful exchange', async () => {
			const exchangeCodeForSession = vi.fn().mockResolvedValue({
				data: {
					user: { id: 'u-oauth' },
					session: { access_token: 'a.jwt', refresh_token: 'r.jwt' },
				},
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(
				clientWith({ exchangeCodeForSession }) as any,
			);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleOAuthCallback(
				getRequest('https://x.test/auth/callback?code=abc123', {
					Cookie: 'sb-pkce-verifier=v-xyz',
				}),
			);
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toBe('https://x.test/my');
			expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');

			const setCookies = res.headers.getSetCookie?.() ?? [];
			expect(setCookies.some((c) => c.startsWith('sb-access-token='))).toBe(true);
			expect(setCookies.some((c) => c.startsWith('sb-refresh-token='))).toBe(true);
			// PKCE cookie is cleared
			expect(setCookies.some((c) => c.startsWith('sb-pkce-verifier=;') && c.includes('Max-Age=0'))).toBe(true);
		});

		it('redirects to /login?error=... when exchangeCodeForSession fails', async () => {
			const exchangeCodeForSession = vi.fn().mockResolvedValue({
				data: { user: null, session: null },
				error: { code: 'invalid_grant', message: 'expired' },
			});
			vi.mocked(createClient).mockReturnValue(
				clientWith({ exchangeCodeForSession }) as any,
			);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleOAuthCallback(
				getRequest('https://x.test/auth/callback?code=abc', {
					Cookie: 'sb-pkce-verifier=v',
				}),
			);
			expect(res.status).toBe(302);
			expect(res.headers.get('Location')).toContain('/login?error=invalid_grant');
			expect(getSetCookies(res).some((c) => c.startsWith('sb-access-token='))).toBe(false);
		});
	});

	describe('handleMagicLink', () => {
		it('rejects malformed body with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMagicLink(
				new Request('https://x.test/api/auth/magic-link', {
					method: 'POST',
					body: 'not json',
					headers: { 'Content-Type': 'application/json' },
				}),
			);
			expect(res.status).toBe(400);
		});

		it('rejects missing email with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMagicLink(
				jsonRequest('https://x.test/api/auth/magic-link', {}),
			);
			expect(res.status).toBe(400);
		});

		it('returns 200 and calls signInWithOtp with shouldCreateUser:false', async () => {
			const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
			vi.mocked(createClient).mockReturnValue(clientWith({ signInWithOtp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMagicLink(
				jsonRequest('https://x.test/api/auth/magic-link', { email: 'a@b.test' }),
			);
			expect(res.status).toBe(200);
			expect(signInWithOtp).toHaveBeenCalledWith({
				email: 'a@b.test',
				options: { shouldCreateUser: false },
			});
		});

		it('returns 200 even when Supabase errors (no enumeration)', async () => {
			const signInWithOtp = vi.fn().mockResolvedValue({
				data: {},
				error: { code: 'user_not_found', message: 'no such user' },
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ signInWithOtp }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMagicLink(
				jsonRequest('https://x.test/api/auth/magic-link', { email: 'nobody@b.test' }),
			);
			expect(res.status).toBe(200);
		});
	});

	describe('handleForgotPassword', () => {
		it('rejects malformed body with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleForgotPassword(
				new Request('https://x.test/api/auth/forgot-password', {
					method: 'POST',
					body: 'not json',
					headers: { 'Content-Type': 'application/json' },
				}),
			);
			expect(res.status).toBe(400);
		});

		it('rejects missing email with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleForgotPassword(
				jsonRequest('https://x.test/api/auth/forgot-password', {}),
			);
			expect(res.status).toBe(400);
		});

		it('returns 200 ok and calls resetPasswordForEmail with the email', async () => {
			const resetPasswordForEmail = vi.fn().mockResolvedValue({ data: {}, error: null });
			vi.mocked(createClient).mockReturnValue(clientWith({ resetPasswordForEmail }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleForgotPassword(
				jsonRequest('https://x.test/api/auth/forgot-password', { email: 'a@b.test' }),
			);
			expect(res.status).toBe(200);
			expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.test');
		});

		it('returns 200 ok even when Supabase errors (no email enumeration)', async () => {
			const resetPasswordForEmail = vi.fn().mockResolvedValue({
				data: {},
				error: { code: 'user_not_found', message: 'no such user' },
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ resetPasswordForEmail }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleForgotPassword(
				jsonRequest('https://x.test/api/auth/forgot-password', { email: 'nobody@b.test' }),
			);
			expect(res.status).toBe(200);
		});
	});

	describe('handleUpdatePassword', () => {
		it('rejects missing password with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleUpdatePassword(
				jsonRequest('https://x.test/api/auth/update-password', {}),
			);
			expect(res.status).toBe(400);
		});

		it('rejects short passwords with 400', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleUpdatePassword(
				jsonRequest('https://x.test/api/auth/update-password', { password: 'short' }),
			);
			expect(res.status).toBe(400);
		});

		it('returns 401 when no session cookie', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleUpdatePassword(
				jsonRequest('https://x.test/api/auth/update-password', { password: 'longenough' }),
			);
			expect(res.status).toBe(401);
		});

		it('returns 401 when setSession rejects the cookies', async () => {
			const setSession = vi.fn().mockResolvedValue({
				data: {},
				error: { code: 'invalid_token', message: 'bad' },
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ setSession }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleUpdatePassword(
				jsonRequest(
					'https://x.test/api/auth/update-password',
					{ password: 'longenough' },
					{ Cookie: `${ACCESS_TOKEN_COOKIE}=a; ${REFRESH_TOKEN_COOKIE}=r` },
				),
			);
			expect(res.status).toBe(401);
		});

		it('returns 200 ok when updateUser succeeds', async () => {
			const setSession = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
			const updateUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
			vi.mocked(createClient).mockReturnValue(clientWith({ setSession, updateUser }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleUpdatePassword(
				jsonRequest(
					'https://x.test/api/auth/update-password',
					{ password: 'new-and-long-enough' },
					{ Cookie: `${ACCESS_TOKEN_COOKIE}=a; ${REFRESH_TOKEN_COOKIE}=r` },
				),
			);
			expect(res.status).toBe(200);
			expect(setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
			expect(updateUser).toHaveBeenCalledWith({ password: 'new-and-long-enough' });
		});

		// Regression: handleUpdatePassword used to call `this.client.auth.setSession(...)`
		// where `this.client` was the cached service-role singleton from
		// `getServiceRoleClient`. supabase-js `_saveSession` writes the user's
		// session into the GoTrueClient's in-memory storage on the singleton —
		// shared across every request landing on the same isolate. No code path
		// reads from session storage today, but it's a latent footgun the moment
		// anyone calls no-arg `getUser()` or `getSession()`.
		//
		// Fix: build a fresh per-request client. This test asserts a NEW
		// createClient call fires inside handleUpdatePassword (so the call count
		// = 1 constructor + 1 per request), and that the per-request client
		// carries `persistSession:false` to bound its memoryStorage to its own
		// lifetime.
		it('builds a fresh per-request supabase client and does not reuse the cached one', async () => {
			const setSession = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
			const updateUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
			vi.mocked(createClient).mockReturnValue(clientWith({ setSession, updateUser }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);
			// Constructor calls getServiceRoleClient → createClient (1).
			expect(vi.mocked(createClient).mock.calls.length).toBe(1);

			await handler.handleUpdatePassword(
				jsonRequest(
					'https://x.test/api/auth/update-password',
					{ password: 'longenough' },
					{ Cookie: `${ACCESS_TOKEN_COOKIE}=a; ${REFRESH_TOKEN_COOKIE}=r` },
				),
			);

			// Per-request createClient (2). If the test ever sees only 1 call
			// here, someone reverted to the shared-client path — fix or risk
			// the cross-request state leak.
			expect(vi.mocked(createClient).mock.calls.length).toBe(2);
			const perRequestCallArgs = vi.mocked(createClient).mock.calls[1];
			expect(perRequestCallArgs[2]?.auth?.persistSession).toBe(false);
		});

		it('returns 400 when updateUser rejects (e.g. password policy)', async () => {
			const setSession = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
			const updateUser = vi.fn().mockResolvedValue({
				data: {},
				error: { code: 'weak_password', message: 'too weak' },
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ setSession, updateUser }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleUpdatePassword(
				jsonRequest(
					'https://x.test/api/auth/update-password',
					{ password: 'longenough' },
					{ Cookie: `${ACCESS_TOKEN_COOKIE}=a; ${REFRESH_TOKEN_COOKIE}=r` },
				),
			);
			expect(res.status).toBe(400);
		});
	});

	describe('getUserIdFromCookie', () => {
		it('returns null when no cookie', async () => {
			vi.mocked(createClient).mockReturnValue(clientWith({}) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);
			expect(await handler.getUserIdFromCookie(getRequest('https://x.test'))).toBeNull();
		});

		it('returns user id when cookie valid', async () => {
			const getUser = vi.fn().mockResolvedValue({
				data: { user: { id: 'cookie-user' } },
				error: null,
			});
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const id = await handler.getUserIdFromCookie(
				getRequest('https://x.test', { Cookie: `${ACCESS_TOKEN_COOKIE}=v` }),
			);
			expect(id).toBe('cookie-user');
		});
	});
});
