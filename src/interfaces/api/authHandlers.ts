import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '../../infrastructure/logging/logger';
import { applyClearCookies, applySessionCookies, getCookie, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './cookies';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

interface SignupBody {
	email?: string;
	password?: string;
}

interface LoginBody {
	email?: string;
	password?: string;
}

/**
 * Worker-side handlers for all Supabase Auth operations. The browser
 * never speaks to Supabase Auth directly. Every auth call goes
 * Browser → Worker (same-origin) → Supabase, with the session stored
 * in HttpOnly cookies that the browser cannot read.
 *
 * Rationale:
 *  - CSP can stay at `connect-src 'self'` (no third-party hosts).
 *  - Worker enforces per-IP rate limiting before Supabase Auth sees
 *    the request (defends against upstream rate-limiter bugs).
 *  - Publishable key never leaves the Worker.
 *  - HttpOnly cookies are inaccessible to XSS-injected JS.
 */
export class AuthHandlers {
	private readonly client: SupabaseClient;

	constructor(
		private readonly supabaseUrl: string,
		secretKey: string,
		private readonly logger: Logger,
	) {
		this.client = createClient(supabaseUrl, secretKey, {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
				detectSessionInUrl: false,
			},
		});
	}

	async handleSignup(request: Request): Promise<Response> {
		let body: SignupBody;
		try {
			body = (await request.json()) as SignupBody;
		} catch {
			return json({ error: { code: 'bad_request', message: 'Invalid JSON' } }, 400);
		}

		const email = body.email?.trim();
		const password = body.password;

		if (!email || !password) {
			return json({ error: { code: 'bad_request', message: 'Email and password are required' } }, 400);
		}
		if (password.length < 6) {
			return json({ error: { code: 'bad_request', message: 'Password must be at least 6 characters' } }, 400);
		}

		const { data, error } = await this.client.auth.signUp({ email, password });

		if (error) {
			this.logger.debug('Auth: signup error', { code: error.code, message: error.message });
			return json({ error: { code: 'signup_failed', message: error.message } }, 400);
		}

		// If email confirmation is required, no session is returned; respond
		// with a needsConfirm flag so the UI can show the "check your email"
		// state without claiming the user is signed in.
		if (!data.session) {
			return json({ user: data.user, needsConfirm: true });
		}

		// Otherwise, persist the session via cookies.
		const res = json({ user: data.user, needsConfirm: false });
		return applySessionCookies(res, data.session.access_token, data.session.refresh_token);
	}

	async handleLogin(request: Request): Promise<Response> {
		let body: LoginBody;
		try {
			body = (await request.json()) as LoginBody;
		} catch {
			return json({ error: { code: 'bad_request', message: 'Invalid JSON' } }, 400);
		}

		const email = body.email?.trim();
		const password = body.password;

		if (!email || !password) {
			return json({ error: { code: 'bad_request', message: 'Email and password are required' } }, 400);
		}

		const { data, error } = await this.client.auth.signInWithPassword({ email, password });

		if (error || !data.session) {
			this.logger.debug('Auth: login error', { code: error?.code, message: error?.message });
			return json({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } }, 401);
		}

		const res = json({ user: data.user });
		return applySessionCookies(res, data.session.access_token, data.session.refresh_token);
	}

	async handleLogout(request: Request): Promise<Response> {
		const accessToken = getCookie(request, ACCESS_TOKEN_COOKIE);
		if (accessToken) {
			// Best-effort: tell Supabase to revoke this session. If it fails
			// the cookie is still cleared and the user is signed out locally.
			try {
				// admin.signOut requires the user JWT to identify the session
				await (this.client.auth as unknown as { admin: { signOut: (jwt: string) => Promise<unknown> } })
					.admin.signOut(accessToken)
					.catch(() => undefined);
			} catch {
				/* ignore */
			}
		}
		const res = json({ ok: true });
		return applyClearCookies(res);
	}

	async handleSession(request: Request): Promise<Response> {
		const accessToken = getCookie(request, ACCESS_TOKEN_COOKIE);
		if (!accessToken) {
			return json({ user: null });
		}

		// Validate the access token. supabase.auth.getUser() returns the
		// authenticated user object iff the token is valid + not expired +
		// not revoked.
		const { data, error } = await this.client.auth.getUser(accessToken);
		if (error || !data?.user) {
			// Token is expired or invalid. Try to refresh if we have a
			// refresh token in the cookie jar.
			const refreshToken = getCookie(request, REFRESH_TOKEN_COOKIE);
			if (!refreshToken) {
				const res = json({ user: null });
				return applyClearCookies(res);
			}

			const refreshed = await this.client.auth.refreshSession({ refresh_token: refreshToken });
			if (refreshed.error || !refreshed.data.session) {
				const res = json({ user: null });
				return applyClearCookies(res);
			}

			const res = json({ user: refreshed.data.user });
			return applySessionCookies(
				res,
				refreshed.data.session.access_token,
				refreshed.data.session.refresh_token,
			);
		}

		return json({ user: data.user });
	}

	/**
	 * GET /api/my — return the calling user's pastes via service_role
	 * + explicit user_id filter. Browser never queries the DB directly.
	 */
	async handleMyPastes(request: Request): Promise<Response> {
		const userId = await this.getUserIdFromCookie(request);
		if (!userId) {
			return json({ error: { code: 'unauthorized', message: 'Sign in required' } }, 401);
		}

		const url = new URL(request.url);
		const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
		const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 50 : rawLimit, 100));

		const { data, error } = await this.client
			.from('pastes')
			.select('id, title, language, visibility, read_count, created_at, expires_at')
			.eq('user_id', userId)
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false })
			.limit(limit);

		if (error) {
			this.logger.error('Auth: my-pastes query failed', { userId, error });
			return json({ error: { code: 'internal', message: 'Failed to load pastes' } }, 500);
		}

		return json({ pastes: data ?? [] });
	}

	/**
	 * Extract user_id from the session cookie. Used by other handlers
	 * that need to authorize the calling user.
	 */
	async getUserIdFromCookie(request: Request): Promise<string | null> {
		const accessToken = getCookie(request, ACCESS_TOKEN_COOKIE);
		if (!accessToken) return null;

		const { data, error } = await this.client.auth.getUser(accessToken);
		if (error || !data?.user) return null;
		return data.user.id;
	}

	/**
	 * GET /auth/confirm — landing page for Supabase Auth confirmation
	 * emails (signup, password recovery, email change). Supabase sends
	 * the user here with `?token_hash=...&type=...&next=...` query
	 * params. The Worker exchanges the token for a session, sets cookies,
	 * and 302s to `next` (defaults to `/`).
	 *
	 * Supabase Dashboard config required:
	 *   - Authentication → URL Configuration → Site URL = https://paste.erfi.io
	 *   - Authentication → URL Configuration → Redirect URLs (allow-list):
	 *       https://paste.erfi.io/auth/confirm
	 *
	 * Email templates in Supabase need their {{ .ConfirmationURL }} or
	 * equivalent set to:
	 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .EmailActionType }}&next=/my
	 */
	async handleConfirm(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const tokenHash = url.searchParams.get('token_hash');
		const type = url.searchParams.get('type');
		const next = url.searchParams.get('next') || '/';

		// Whitelist `next` to same-origin paths only to avoid open-redirect.
		const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

		if (!tokenHash || !type) {
			return Response.redirect(new URL('/login?error=missing_token', request.url).toString(), 302);
		}

		// type can be: 'signup' | 'recovery' | 'invite' | 'email_change' | 'magiclink' | 'email'
		// supabase.auth.verifyOtp accepts these via the EmailOtpType union.
		const validTypes = new Set(['signup', 'recovery', 'invite', 'email_change', 'magiclink', 'email']);
		if (!validTypes.has(type)) {
			return Response.redirect(new URL('/login?error=invalid_type', request.url).toString(), 302);
		}

		const { data, error } = await this.client.auth.verifyOtp({
			token_hash: tokenHash,
			type: type as 'signup' | 'recovery' | 'invite' | 'email_change' | 'magiclink' | 'email',
		});

		if (error || !data.session) {
			this.logger.debug('Auth: confirm verifyOtp failed', { type, code: error?.code, message: error?.message });
			return Response.redirect(
				new URL(`/login?error=${encodeURIComponent(error?.code ?? 'confirm_failed')}`, request.url).toString(),
				302,
			);
		}

		// Build a 302 redirect, then attach the session cookies. Browser
		// follows the redirect with the cookies set.
		const redirect = new Response(null, {
			status: 302,
			headers: { Location: new URL(safeNext, request.url).toString() },
		});
		return applySessionCookies(redirect, data.session.access_token, data.session.refresh_token);
	}
}
