import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Logger } from '../../infrastructure/logging/logger';
import { applyClearCookies, applySessionCookies, getCookie, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './cookies';
import { getServiceRoleClient } from '../../infrastructure/supabase/getSupabaseClient';

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
	// Kept around so the OAuth handlers can build per-request clients with
	// custom (PKCE-aware) storage. The cached `client` above uses
	// persistSession: false and isn't suitable for PKCE.
	private readonly url: string;
	private readonly secretKey: string;

	constructor(
		supabaseUrl: string,
		secretKey: string,
		private readonly logger: Logger,
	) {
		this.url = supabaseUrl;
		this.secretKey = secretKey;
		this.client = getServiceRoleClient(supabaseUrl, secretKey);
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

		// Detect Supabase's anti-enumeration response: when the email is
		// already registered, Supabase returns a normal-looking success
		// payload but with `user.identities = []`. The "no session" path
		// below would otherwise tell the UI to show "check your email" —
		// no email was sent, the user is left confused. Surface a clear
		// error instead.
		//
		// Trade-off: this leaks "email exists" to anyone who tries it.
		// Acceptable for Pasteriser — bot-signup defense lives in Phase
		// 4.7 (Worker-side rate limit + future captcha/honeypot), not in
		// hiding existence. Documented in SECURITY.md.
		if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
			this.logger.debug('Auth: signup duplicate email', { email });
			return json(
				{ error: { code: 'email_taken', message: 'An account with this email already exists. Try logging in.' } },
				409,
			);
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

			// Distinguish email-not-confirmed from wrong-password so the UI
			// can guide the user. Supabase returns code 'email_not_confirmed'
			// in this case (GoTrue >= 2.150). Falls through to a generic
			// invalid_credentials otherwise.
			if (error?.code === 'email_not_confirmed') {
				return json(
					{
						error: {
							code: 'email_not_confirmed',
							message:
								'Please confirm your email first. Check your inbox for the confirmation link we sent.',
						},
					},
					403,
				);
			}

			return json({ error: { code: 'invalid_credentials', message: 'Invalid email or password' } }, 401);
		}

		const res = json({ user: data.user });
		return applySessionCookies(res, data.session.access_token, data.session.refresh_token);
	}

	/**
	 * POST /api/auth/magic-link — send a passwordless sign-in link.
	 * Body: { email: string }
	 *
	 * Calls `supabase.auth.signInWithOtp()` which sends an email using
	 * `mailer_templates_magic_link_content`. The template points to
	 * `/auth/confirm?type=magiclink&next=/my` so the same Worker handler
	 * we use for signup confirmation handles the OTP exchange.
	 *
	 * Always returns 200 (anti-enumeration). Supabase's per-email rate
	 * limit (`smtp_max_frequency`) prevents spamming a single address.
	 */
	async handleMagicLink(request: Request): Promise<Response> {
		let body: { email?: string };
		try {
			body = (await request.json()) as { email?: string };
		} catch {
			return json({ error: { code: 'bad_request', message: 'Invalid JSON' } }, 400);
		}

		const email = body.email?.trim();
		if (!email) {
			return json({ error: { code: 'bad_request', message: 'Email is required' } }, 400);
		}

		// shouldCreateUser:false → if the email doesn't exist, no user is
		// created and no email is sent. Keeps Pasteriser email-based
		// signup as the only way to create accounts (matches current UX —
		// magic link is for re-entry, not first signup).
		const { error } = await this.client.auth.signInWithOtp({
			email,
			options: { shouldCreateUser: false },
		});
		if (error) {
			this.logger.debug('Auth: magic-link error', { code: error.code, message: error.message });
		}
		return json({ ok: true });
	}

	/**
	 * POST /api/auth/forgot-password — kick off the password-reset flow.
	 * Body: { email: string }
	 *
	 * Calls `supabase.auth.resetPasswordForEmail()` which sends an email
	 * using the `mailer_templates_recovery_content` template. The template
	 * points at our `/auth/confirm?type=recovery&next=/auth/reset-password`
	 * route, which exchanges the token for a session and 302s to the
	 * reset-password page. From there the user submits a new password
	 * via `handleUpdatePassword()` below.
	 *
	 * Always returns 200 to avoid email enumeration; Supabase's own
	 * rate-limit (`rate_limit_email_sent`) gates abuse.
	 */
	async handleForgotPassword(request: Request): Promise<Response> {
		let body: { email?: string };
		try {
			body = (await request.json()) as { email?: string };
		} catch {
			return json({ error: { code: 'bad_request', message: 'Invalid JSON' } }, 400);
		}

		const email = body.email?.trim();
		if (!email) {
			return json({ error: { code: 'bad_request', message: 'Email is required' } }, 400);
		}

		const { error } = await this.client.auth.resetPasswordForEmail(email);
		if (error) {
			this.logger.debug('Auth: forgot-password error', { code: error.code, message: error.message });
		}
		return json({ ok: true });
	}

	/**
	 * POST /api/auth/update-password — change the password of the currently
	 * signed-in user. Used by the reset-password page after the recovery
	 * email's confirmation link landed the user with a fresh session.
	 *
	 * Body: { password: string }
	 *
	 * Requires the `sb-access-token` cookie. Calls `updateUser({ password })`
	 * against a client that's seeded with the user's session via
	 * `setSession()`. Without setSession the call would use the service-role
	 * client and need an admin code path.
	 */
	async handleUpdatePassword(request: Request): Promise<Response> {
		let body: { password?: string };
		try {
			body = (await request.json()) as { password?: string };
		} catch {
			return json({ error: { code: 'bad_request', message: 'Invalid JSON' } }, 400);
		}

		const password = body.password;
		if (!password) {
			return json({ error: { code: 'bad_request', message: 'Password is required' } }, 400);
		}
		if (password.length < 6) {
			return json({ error: { code: 'bad_request', message: 'Password must be at least 6 characters' } }, 400);
		}

		const accessToken = getCookie(request, ACCESS_TOKEN_COOKIE);
		const refreshToken = getCookie(request, REFRESH_TOKEN_COOKIE);
		if (!accessToken || !refreshToken) {
			return json({ error: { code: 'unauthorized', message: 'Sign in required' } }, 401);
		}

		// Set the session on the client so updateUser() runs as the user.
		// Without this it would error out — service_role can't change
		// passwords via the non-admin endpoint.
		const { error: sessErr } = await this.client.auth.setSession({
			access_token: accessToken,
			refresh_token: refreshToken,
		});
		if (sessErr) {
			this.logger.debug('Auth: update-password setSession failed', {
				code: sessErr.code,
				message: sessErr.message,
			});
			return json({ error: { code: 'unauthorized', message: 'Invalid session' } }, 401);
		}

		const { error } = await this.client.auth.updateUser({ password });
		if (error) {
			this.logger.debug('Auth: update-password error', { code: error.code, message: error.message });
			return json({ error: { code: 'update_failed', message: error.message } }, 400);
		}

		return json({ ok: true });
	}

	/**
	 * POST /api/auth/resend-confirmation — re-send the signup confirmation
	 * email. Used by the login form when it detects `email_not_confirmed`,
	 * and by the signup success panel as a "didn't get it" link.
	 *
	 * Body: { email: string }
	 *
	 * Always returns 200 (even if the email doesn't exist) to avoid leaking
	 * enumeration, except for malformed bodies. Supabase's own per-email
	 * rate limit (smtp_max_frequency + rate_limit_email_sent) gates abuse.
	 */
	async handleResendConfirmation(request: Request): Promise<Response> {
		let body: { email?: string };
		try {
			body = (await request.json()) as { email?: string };
		} catch {
			return json({ error: { code: 'bad_request', message: 'Invalid JSON' } }, 400);
		}

		const email = body.email?.trim();
		if (!email) {
			return json({ error: { code: 'bad_request', message: 'Email is required' } }, 400);
		}

		const { error } = await this.client.auth.resend({ type: 'signup', email });
		if (error) {
			// Log for diagnostics but don't leak detail to the client.
			this.logger.debug('Auth: resend error', { code: error.code, message: error.message });
		}

		return json({ ok: true });
	}

	async handleLogout(request: Request): Promise<Response> {
		const accessToken = getCookie(request, ACCESS_TOKEN_COOKIE);
		if (accessToken) {
			// admin.signOut(jwt, scope) takes a JWT (used as bearer on POST
			// /logout). scope='global' revokes EVERY refresh token for the
			// user — without it, only the current session would be revoked
			// and a copy of the refresh-token cookie elsewhere would survive.
			await this.client.auth.admin
				.signOut(accessToken, 'global')
				.catch(() => undefined);
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
	 *
	 * Keyset-paginated. Caller supplies `?cursor=<iso>&limit=<n>`. The
	 * response includes a `nextCursor` (the created_at of the last returned
	 * row) which the client passes to the next call. Cursor is ISO 8601
	 * timestamp — same shape as `created_at` itself. When `nextCursor` is
	 * null the caller has reached the end of the user's pastes.
	 *
	 * Why keyset over offset: with offset pagination a slow user navigating
	 * deeper pages re-scans all earlier rows for each page; with keyset the
	 * planner uses the `(user_id, created_at)` index range directly. Also
	 * resilient to inserts between fetches — offset would skip rows.
	 *
	 * Edge case: two rows with the exact same `created_at` (microsecond
	 * precision; collision within a single user is extremely rare) could be
	 * skipped if the cursor lands between them. We accept this; the
	 * alternative is composite (created_at, id) cursors which complicate
	 * encoding for negligible benefit.
	 */
	async handleMyPastes(request: Request): Promise<Response> {
		const userId = await this.getUserIdFromCookie(request);
		if (!userId) {
			return json({ error: { code: 'unauthorized', message: 'Sign in required' } }, 401);
		}

		const url = new URL(request.url);
		const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
		const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 50 : rawLimit, 100));
		const cursor = url.searchParams.get('cursor');

		// Validate cursor BEFORE hitting the DB. Bad cursor → 400 rather than
		// silently returning the first page (which would loop the client).
		let cursorIso: string | null = null;
		if (cursor) {
			const parsed = new Date(cursor);
			if (isNaN(parsed.getTime())) {
				return json({ error: { code: 'bad_cursor', message: 'cursor must be a valid ISO timestamp' } }, 400);
			}
			cursorIso = parsed.toISOString();
		}

		let query = this.client
			.from('pastes')
			.select('id, title, language, visibility, read_count, created_at, expires_at')
			.eq('user_id', userId)
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false })
			.limit(limit + 1); // +1 to know if there's another page without a second roundtrip

		if (cursorIso) {
			query = query.lt('created_at', cursorIso);
		}

		const { data, error } = await query;

		if (error) {
			this.logger.error('Auth: my-pastes query failed', { userId, error });
			return json({ error: { code: 'internal', message: 'Failed to load pastes' } }, 500);
		}

		const rows = data ?? [];
		const hasMore = rows.length > limit;
		const pastes = hasMore ? rows.slice(0, limit) : rows;
		const nextCursor = hasMore && pastes.length > 0 ? pastes[pastes.length - 1].created_at : null;

		return json({ pastes, nextCursor });
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
	 * GET /api/auth/oauth/:provider — kick off an OAuth redirect flow.
	 *
	 * Pattern: we need PKCE but don't have supabase-js in the browser, so
	 * the Worker handles both sides. supabase-js stores the PKCE
	 * code_verifier in `storage.setItem()` synchronously during
	 * `signInWithOAuth()`; we provide a tiny capture-only storage and
	 * stash the captured verifier in a short-lived HttpOnly cookie
	 * (`sb-pkce-verifier`). The browser then bounces through Supabase's
	 * /authorize and the provider's authorize, lands back on our
	 * `/auth/callback?code=...`, and the callback handler reads the
	 * cookie + exchanges the code for a session.
	 *
	 * SameSite=Lax on the PKCE cookie because the user returns to our
	 * origin via a top-level redirect from Supabase — Strict would drop
	 * the cookie cross-origin.
	 */
	async handleOAuthStart(request: Request, provider: string): Promise<Response> {
		const validProviders = new Set(['github', 'google']);
		if (!validProviders.has(provider)) {
			return json({ error: { code: 'bad_request', message: 'Unknown OAuth provider' } }, 400);
		}

		// Capture the PKCE verifier as supabase-js writes it during
		// signInWithOAuth. The storage key looks like
		// `sb-<ref>-auth-token-code-verifier` — match by substring.
		let capturedVerifier: string | null = null;
		const captureStorage = {
			getItem: () => null,
			setItem: (key: string, value: string) => {
				if (key.includes('code-verifier')) capturedVerifier = value;
			},
			removeItem: () => undefined,
		};

		const client = createClient(this.url, this.secretKey, {
			auth: {
				storage: captureStorage as unknown as Storage,
				persistSession: true,
				flowType: 'pkce',
				autoRefreshToken: false,
				detectSessionInUrl: false,
			},
		});

		const origin = new URL(request.url).origin;
		const { data, error } = await client.auth.signInWithOAuth({
			provider: provider as 'github' | 'google',
			options: {
				redirectTo: `${origin}/auth/callback`,
				skipBrowserRedirect: true,
			},
		});

		if (error || !data?.url || !capturedVerifier) {
			this.logger.debug('Auth: oauth start failed', {
				provider,
				code: error?.code,
				message: error?.message,
				hasUrl: !!data?.url,
				hasVerifier: !!capturedVerifier,
			});
			return Response.redirect(
				new URL(`/login?error=${encodeURIComponent(error?.code ?? 'oauth_failed')}`, request.url).toString(),
				302,
			);
		}

		const resp = new Response(null, {
			status: 302,
			headers: { Location: data.url },
		});
		// 10 min TTL is plenty — OAuth dances usually take seconds.
		resp.headers.append(
			'Set-Cookie',
			`sb-pkce-verifier=${capturedVerifier}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
		);
		return resp;
	}

	/**
	 * GET /auth/callback — OAuth flow lands here from Supabase after the
	 * provider authorizes. Reads the `code` query param and the PKCE
	 * verifier cookie, exchanges them for a session via supabase-js's
	 * `exchangeCodeForSession`, sets the standard HttpOnly session cookies,
	 * clears the temporary PKCE verifier cookie, and 302s to /my.
	 */
	async handleOAuthCallback(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const code = url.searchParams.get('code');
		const errorParam = url.searchParams.get('error');
		const errorDesc = url.searchParams.get('error_description');

		if (errorParam) {
			this.logger.debug('Auth: oauth callback returned error', { error: errorParam, desc: errorDesc });
			return Response.redirect(
				new URL(`/login?error=${encodeURIComponent(errorParam)}`, request.url).toString(),
				302,
			);
		}
		if (!code) {
			return Response.redirect(
				new URL('/login?error=missing_code', request.url).toString(),
				302,
			);
		}

		const verifier = getCookie(request, 'sb-pkce-verifier');
		if (!verifier) {
			return Response.redirect(
				new URL('/login?error=missing_verifier', request.url).toString(),
				302,
			);
		}

		// Seed the captured verifier into storage so supabase-js can read it
		// in exchangeCodeForSession.
		const seedStorage = {
			getItem: (key: string) => (key.includes('code-verifier') ? verifier : null),
			setItem: () => undefined,
			removeItem: () => undefined,
		};

		const client = createClient(this.url, this.secretKey, {
			auth: {
				storage: seedStorage as unknown as Storage,
				persistSession: true,
				flowType: 'pkce',
				autoRefreshToken: false,
				detectSessionInUrl: false,
			},
		});

		const { data, error } = await client.auth.exchangeCodeForSession(code);
		if (error || !data.session) {
			this.logger.debug('Auth: oauth exchange failed', { code: error?.code, message: error?.message });
			return Response.redirect(
				new URL(
					`/login?error=${encodeURIComponent(error?.code ?? 'oauth_failed')}`,
					request.url,
				).toString(),
				302,
			);
		}

		const redirect = new Response(null, {
			status: 302,
			headers: { Location: new URL('/my', request.url).toString() },
		});
		// Clear the one-shot PKCE verifier cookie.
		redirect.headers.append(
			'Set-Cookie',
			'sb-pkce-verifier=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
		);
		return applySessionCookies(redirect, data.session.access_token, data.session.refresh_token);
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

		// Open-redirect defence: construct the candidate URL with the request
		// origin as base, then verify the resolved origin matches. A naïve
		// startsWith('/') check is insufficient because the WHATWG URL parser
		// maps backslash to forward slash for special schemes, so
		//   new URL('/\\evil.com', 'https://paste.erfi.io')
		// resolves to 'https://evil.com/' — bypassing a `!startsWith('//')`
		// guard. Origin equality post-parse closes that.
		let safeNext = '/';
		try {
			const candidate = new URL(next, request.url);
			if (candidate.origin === url.origin) {
				safeNext = candidate.pathname + candidate.search + candidate.hash;
			}
		} catch {
			/* fall through with safeNext = '/' */
		}

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
