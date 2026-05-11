import { describe, it, expect, vi, beforeEach } from 'vitest';
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
	getUser?: ReturnType<typeof vi.fn>;
	refreshSession?: ReturnType<typeof vi.fn>;
	verifyOtp?: ReturnType<typeof vi.fn>;
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
			const terminator = Promise.resolve({ data: rows, error });
			const chain: Record<string, any> = {
				select: vi.fn(() => chain),
				eq: vi.fn(() => chain),
				gt: vi.fn(() => chain),
				order: vi.fn(() => chain),
				limit: vi.fn(() => terminator),
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
			const chain = withChain([{ id: 'p1', title: 'mine', user_id: 'user-99' }]);
			const from = vi.fn(() => chain);
			vi.mocked(createClient).mockReturnValue(clientWith({ getUser }, from) as any);
			const handler = new AuthHandlers('https://x.supabase.co', 'sb_secret_test', mockLogger);

			const res = await handler.handleMyPastes(
				getRequest('https://x.test/api/my', { Cookie: `${ACCESS_TOKEN_COOKIE}=valid` }),
			);

			expect(res.status).toBe(200);
			expect(from).toHaveBeenCalledWith('pastes');
			expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-99');
			const body = (await res.json()) as { pastes: unknown[] };
			expect(body.pastes).toHaveLength(1);
		});

		it('clamps limit to [1, 100]', async () => {
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
			expect(chain.limit).toHaveBeenCalledWith(100);
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
