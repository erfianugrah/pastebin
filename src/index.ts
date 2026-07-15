import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { getApplicationBaseUrl } from './infrastructure/config/config';
import { SupabasePasteRepository } from './infrastructure/storage/supabasePasteRepository';
import { AuthService } from './infrastructure/auth/authService';
import { PasteRepository } from './domain/repositories/pasteRepository';
import { CloudflareUniqueIdService } from './infrastructure/services/cloudflareUniqueIdService';
import { DefaultExpirationService } from './domain/services/expirationService';
import { CreatePasteCommand } from './application/commands/createPasteCommand';
import { DeletePasteCommand } from './application/commands/deletePasteCommand';
import { UpdatePasteCommand } from './application/commands/updatePasteCommand';
import { GetPasteQuery } from './application/queries/getPasteQuery';
import { GetRecentPastesQuery } from './application/queries/getRecentPastesQuery';
import { SearchPastesQuery } from './application/queries/searchPastesQuery';
import { GetPasteStatsQuery } from './application/queries/getPasteStatsQuery';
import { ApiHandlers } from './interfaces/api/handlers';
import { AuthHandlers } from './interfaces/api/authHandlers';
import { securityHeaders } from './interfaces/api/middleware';
import { rateLimit } from './interfaces/api/rateLimit';
import { AppError } from './infrastructure/errors/AppError';
import { Logger } from './infrastructure/logging/logger';
import { addCacheHeaders, cacheStaticAsset, preventCaching } from './infrastructure/caching/cacheControl';

// ---------- Stateless singletons (safe to reuse across requests) ----------

const uniqueIdService = new CloudflareUniqueIdService();
const expirationService = new DefaultExpirationService();

// ---------- Hono app ----------

type AppEnv = {
	Bindings: Env;
	Variables: {
		requestId: string;
		logger: Logger;
		handlers: ApiHandlers;
		authHandlers: AuthHandlers;
		pasteRepository: PasteRepository;
		authService: AuthService;
	};
};

// Keys that may carry secrets in URL query strings. We log query params for
// debuggability but redact these because Cloudflare logpush captures every
// log line, and once a token lands in logpush it lives there for the
// retention window. Add to this list, never remove.
const SENSITIVE_QUERY_KEYS = new Set([
	'token', // delete token
	'token_hash', // auth confirm token hash
	'code', // OAuth code
	'access_token',
	'refresh_token',
]);

function redactSensitiveQueryParams(params: URLSearchParams): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of params) {
		out[key] = SENSITIVE_QUERY_KEYS.has(key) ? '[redacted]' : value;
	}
	return out;
}

const app = new Hono<AppEnv>();

// ---- Global middleware ----

// 1. Request logging & dependency injection
app.use('*', async (c, next) => {
	const logger = new Logger();
	const requestId = crypto.randomUUID();
	const url = new URL(c.req.url);
	const cfData = (c.req.raw as any).cf || {};

	logger.setContext({
		requestId,
		url: c.req.url,
		method: c.req.method,
		path: url.pathname,
		cf: {
			country: cfData.country,
			colo: cfData.colo,
			asn: cfData.asn,
			clientTcpRtt: cfData.clientTcpRtt,
		},
	});

	logger.info(`${c.req.method} ${url.pathname}`, {
		queryParams: redactSensitiveQueryParams(url.searchParams),
		headers: {
			'user-agent': c.req.header('user-agent'),
			'content-type': c.req.header('content-type'),
			accept: c.req.header('accept'),
		},
	});

	c.set('requestId', requestId);
	c.set('logger', logger);

	const pasteRepository: PasteRepository = new SupabasePasteRepository(
		c.env.SUPABASE_URL,
		c.env.SUPABASE_SECRET_KEY,
		logger,
	);

	const createPasteCommand = new CreatePasteCommand(
		pasteRepository,
		uniqueIdService,
		expirationService,
		getApplicationBaseUrl(url),
	);
	const deletePasteCommand = new DeletePasteCommand(pasteRepository);
	const updatePasteCommand = new UpdatePasteCommand(pasteRepository);
	const getPasteQuery = new GetPasteQuery(pasteRepository);
	const getRecentPastesQuery = new GetRecentPastesQuery(pasteRepository, logger);
	const searchPastesQuery = new SearchPastesQuery(pasteRepository, logger);
	const getPasteStatsQuery = new GetPasteStatsQuery(pasteRepository, logger);

	const authService = new AuthService(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY, logger);
	const authHandlers = new AuthHandlers(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY, logger);

	const apiHandlers = new ApiHandlers(
		createPasteCommand,
		deletePasteCommand,
		updatePasteCommand,
		getPasteQuery,
		getRecentPastesQuery,
		searchPastesQuery,
		getPasteStatsQuery,
		logger,
		authService,
	);

	c.set('handlers', apiHandlers);
	c.set('authHandlers', authHandlers);
	c.set('pasteRepository', pasteRepository);
	c.set('authService', authService);

	await next();
});

// 2. CORS — origin '*' WITHOUT credentials (fixes the open-CORS-with-credentials bug)
app.use(
	'*',
	cors({
		origin: '*',
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
	}),
);

// 3. Security headers (runs after handler, adds headers to every response)
app.use('*', securityHeaders);

// ---- Error handler ----

app.onError((err, c) => {
	const logger = c.get('logger');

	if (err instanceof AppError) {
		logger?.warn(`AppError: ${err.code}`, {
			statusCode: err.statusCode,
			message: err.message,
			details: err.details,
		});
		return err.toResponse();
	}

	if (logger) {
		logger.error('Unhandled error', {
			error: err.message,
			stack: err.stack,
			url: c.req.url,
			method: c.req.method,
		});
	} else {
		console.error('Unhandled error:', err);
	}

	return c.json({ error: { code: 'internal_server_error', message: 'An unexpected error occurred' } }, 500);
});

// ---- API routes ----

// POST /pastes — create paste
app.post('/pastes', rateLimit('RL_PASTE_CREATE', 'paste-create'), async (c) => {
	return preventCaching(await c.get('handlers').handleCreatePaste(c.req.raw));
});

// GET /api/recent — recent public pastes
//
// SAFETY: The handler returns ONLY public, non-expired pastes (no user
// scoping, no auth-derived data). The response is identical for every
// caller, which is why `Cache-Control: public` is safe here. If you ever
// add user-scoped or auth-derived data to this endpoint, switch to
// `preventCaching` (or `private` + `Vary: Cookie`) FIRST or the cache
// becomes a leak vector.
// GET /api/recent/live - same-origin WebSocket relay for live /recent updates.
//
// BFF invariant: the browser opens ONLY this same-origin socket. The upstream
// Supabase Realtime subscription (anon key + Supabase URL) lives entirely
// inside the RecentFeedDO, never in the frontend or CSP. A non-WebSocket
// request gets 426 so callers can't accidentally treat it as a JSON endpoint.
app.get('/api/recent/live', async (c) => {
	const upgrade = c.req.header('Upgrade');
	if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
		return c.text('Upgrade Required', 426);
	}
	const id = c.env.RECENT_FEED.idFromName('global');
	return c.env.RECENT_FEED.get(id).fetch(c.req.raw);
});

app.get('/api/recent', rateLimit('RL_RECENT', 'recent'), async (c) => {
	return addCacheHeaders(await c.get('handlers').handleGetRecentPastes(c.req.raw), {
		maxAge: 60,
		staleWhileRevalidate: 300,
	});
});

// GET /api/search — full-text search across public pastes
//
// SAFETY: Same as /api/recent. Public-only data. Keep it that way or
// drop the `public` cache directive.
app.get('/api/search', rateLimit('RL_SEARCH', 'search'), async (c) => {
	return addCacheHeaders(await c.get('handlers').handleSearchPastes(c.req.raw), {
		maxAge: 30,
		staleWhileRevalidate: 120,
	});
});

// GET /api/stats — aggregate stats over non-expired public pastes
//
// SAFETY: Aggregates only. Public-only data. Same rule as above.
app.get('/api/stats', rateLimit('RL_VIEW', 'stats'), async (c) => {
	return addCacheHeaders(await c.get('handlers').handlePasteStats(c.req.raw), {
		maxAge: 300,
		staleWhileRevalidate: 900,
	});
});

// ---- Auth (browser → Worker → Supabase) ----
// All Supabase Auth calls are proxied through the Worker so the browser
// never speaks to Supabase directly. Session is stored in HttpOnly cookies.

app.post('/api/auth/signup', rateLimit('RL_AUTH_WRITE', 'signup'), async (c) =>
	preventCaching(await c.get('authHandlers').handleSignup(c.req.raw)),
);
app.post('/api/auth/login', rateLimit('RL_AUTH_WRITE', 'login'), async (c) =>
	preventCaching(await c.get('authHandlers').handleLogin(c.req.raw)),
);
// Logout: no rate limit. Allowing high-frequency logout (e.g., user clearing
// many tabs) shouldn't be punished; revoking sessions is desirable.
app.post('/api/auth/logout', async (c) => preventCaching(await c.get('authHandlers').handleLogout(c.req.raw)));
app.get('/api/auth/session', rateLimit('RL_SESSION_READ', 'session'), async (c) =>
	preventCaching(await c.get('authHandlers').handleSession(c.req.raw)),
);
app.post('/api/auth/resend-confirmation', rateLimit('RL_AUTH_WRITE', 'resend-confirmation'), async (c) =>
	preventCaching(await c.get('authHandlers').handleResendConfirmation(c.req.raw)),
);
app.post('/api/auth/forgot-password', rateLimit('RL_AUTH_WRITE', 'forgot-password'), async (c) =>
	preventCaching(await c.get('authHandlers').handleForgotPassword(c.req.raw)),
);
app.post('/api/auth/update-password', rateLimit('RL_AUTH_WRITE', 'update-password'), async (c) =>
	preventCaching(await c.get('authHandlers').handleUpdatePassword(c.req.raw)),
);
app.post('/api/auth/magic-link', rateLimit('RL_AUTH_WRITE', 'magic-link'), async (c) =>
	preventCaching(await c.get('authHandlers').handleMagicLink(c.req.raw)),
);

// GET /api/auth/oauth/:provider — start the OAuth flow. Browser 302s
// to Supabase's /authorize, which 302s to the provider, which lands
// back on /auth/callback below. Rate-limited because each call burns a
// Supabase /authorize round-trip + writes a PKCE-verifier cookie.
app.get('/api/auth/oauth/:provider', rateLimit('RL_AUTH_WRITE', 'oauth-start'), async (c) => {
	const provider = c.req.param('provider');
	return preventCaching(await c.get('authHandlers').handleOAuthStart(c.req.raw, provider));
});

// GET /auth/callback — OAuth flow returns here from Supabase with a
// PKCE code. Worker exchanges + sets session cookies + 302s to /my.
// Not rate-limited: the PKCE code is single-use and bound to a verifier
// cookie that only the legitimate flow holds. A flood here would just
// exchange invalid codes, costing one Supabase RPC per attempt — same
// shape as `/auth/confirm` below but with a stronger natural gate.
app.get('/auth/callback', async (c) =>
	preventCaching(await c.get('authHandlers').handleOAuthCallback(c.req.raw)),
);

// GET /auth/confirm — landing page Supabase Auth redirects to from
// confirmation emails (signup, password recovery, email change). The
// Worker verifies the token, sets HttpOnly session cookies, and 302s to
// `?next=` (defaults to `/`). Same-origin redirect target only.
// Rate-limited because each request fires `auth.verifyOtp` — without a
// bucket, an attacker can amplify Supabase calls 1:1 per HTTP request.
app.get('/auth/confirm', rateLimit('RL_AUTH_WRITE', 'auth-confirm'), async (c) =>
	preventCaching(await c.get('authHandlers').handleConfirm(c.req.raw)),
);

// GET /api/my — current user's pastes (browser via Worker, RLS-bypass + filter).
// Loose RL_VIEW backstop: each call is a DB round-trip PLUS a getUser()
// network hop to Supabase, so it's worth bounding even though it's cheap.
app.get('/api/my', rateLimit('RL_VIEW', 'my'), async (c) => preventCaching(await c.get('authHandlers').handleMyPastes(c.req.raw)));

// DELETE|POST /pastes/:id/delete — delete paste (API). Token-gated
// (delete_token UUID is the only authorisation), but still rate-limited
// to bound the cost of an attacker flooding random IDs+tokens. Each
// request fires the `delete_paste` Postgres RPC.
app.on(
	['DELETE', 'POST'],
	'/pastes/:id/delete',
	rateLimit('RL_PASTE_CREATE', 'paste-delete'),
	async (c) => {
		const pasteId = c.req.param('id');
		return preventCaching(await c.get('handlers').handleDeletePaste(c.req.raw, pasteId));
	},
);

// GET /pastes/:id/delete — serve the delete confirmation HTML page
// (token is NOT accepted via GET query params to avoid leaking in logs/referer)
app.get('/pastes/:id/delete', async (c) => {
	const accept = c.req.header('accept') || '';
	if (accept.includes('text/html')) {
		const url = new URL(c.req.url);
		const assetRequest = new Request(url.origin + '/pastes/index/delete/index.html', c.req.raw);
		return cacheStaticAsset(await c.env.ASSETS.fetch(assetRequest), 'html');
	}
	return c.json({ error: { code: 'method_not_allowed', message: 'Use DELETE or POST to delete a paste' } }, 405);
});

// PUT /pastes/:id — update paste (requires delete_token). Same bucket
// as paste-create + a distinct scope. The update path goes through
// `update_paste` RPC so it's race-free with `view_paste` burns (see
// supabase/migrations/.../update_paste_rpc.sql).
app.put('/pastes/:id', rateLimit('RL_PASTE_CREATE', 'paste-update'), async (c) => {
	const pasteId = c.req.param('id');
	return preventCaching(await c.get('handlers').handleUpdatePaste(c.req.raw, pasteId));
});

// GET /pastes — index without an ID
app.get('/pastes', async (c) => {
	const accept = c.req.header('accept') || '';
	if (accept.includes('application/json')) {
		return c.json({ message: 'Paste ID is required', publicPastes: [] }, 400);
	}
	return c.redirect(new URL(c.req.url).origin, 302);
});

// GET /pastes/raw/:id — raw content
app.get('/pastes/raw/:id', rateLimit('RL_VIEW', 'view-raw'), async (c) => {
	const pasteId = c.req.param('id');
	const response = await c.get('handlers').handleGetPaste(c.req.raw, pasteId);

	if (response.status === 200) {
		const responseData = (await response.json()) as { content: string };
		// ALWAYS uncacheable — same rationale as the JSON `/pastes/:id` route
		// below. `handleGetPaste` runs through `view_paste()`, which bumps
		// read_count and may burn the row (burn-after-reading / view_limit).
		// A `public` cache directive here would let shared caches (corporate
		// proxy, ISP) serve burned content to later viewers, and let a browser
		// refresh re-read burned content without a server round-trip (also
		// skewing read_count, since cache hits never reach view_paste()).
		return preventCaching(
			new Response(responseData.content, {
				status: 200,
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			}),
		);
	}
	return response;
});

// GET|POST /pastes/:id — view paste (JSON or HTML page)
//
// JSON path is ALWAYS uncacheable. `handleGetPaste` goes through
// `view_paste()` which atomically bumps read_count, may burn the row
// (burn-after-reading), and enforces view_limit. A cached response
// would let:
//   - the original viewer refresh and re-read burned content (no
//     server round-trip, DB row already gone)
//   - downstream shared caches (corporate proxy, ISP) serve burned
//     content to subsequent users hitting the same Cache-Control:
//     public response.
// The HTML viewer shell stays cacheable — it's a generic Astro page
// that fetches the JSON itself with appropriate cache semantics.
app.on(['GET', 'POST'], '/pastes/:id', rateLimit('RL_VIEW', 'view'), async (c) => {
	const pasteId = c.req.param('id');
	const accept = c.req.header('accept') || '';
	const wantsJson = accept.includes('application/json');

	if (wantsJson) {
		const response = await c.get('handlers').handleGetPaste(c.req.raw, pasteId);
		return preventCaching(response);
	}

	// Serve the Astro-generated viewer page
	const url = new URL(c.req.url);
	const assetRequest = new Request(url.origin + '/pastes/index/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(assetRequest), 'html');
});

// ---- Vanity URL: /p/:slug ----

app.get('/p/:slug', rateLimit('RL_VIEW', 'view-slug'), async (c) => {
	const slug = c.req.param('slug');

	// Resolve slug using the same repository instantiated by middleware
	const pasteId = await c.get('pasteRepository').resolveSlug(slug);

	if (!pasteId) {
		return c.json({ error: { code: 'not_found', message: 'Paste not found' } }, 404);
	}

	const accept = c.req.header('accept') || '';
	if (accept.includes('application/json')) {
		const response = await c.get('handlers').handleGetPaste(c.req.raw, pasteId);
		// JSON path uncacheable — see /pastes/:id route for rationale.
		return preventCaching(response);
	}

	// Serve the vanity viewer page (or fall back to paste viewer page)
	const url = new URL(c.req.url);
	const assetRequest = new Request(url.origin + '/p/index/index.html', c.req.raw);
	try {
		const assetResponse = await c.env.ASSETS.fetch(assetRequest);
		if (assetResponse.ok) return cacheStaticAsset(assetResponse, 'html');
	} catch { /* fall through */ }
	// Fallback to paste viewer
	const fallback = new Request(url.origin + '/pastes/index/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(fallback), 'html');
});

// ---- Static pages ----

app.get('/recent', async (c) => {
	const url = new URL(c.req.url);
	const req = new Request(url.origin + '/recent/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(req), 'html');
});

// ---- Auth + user pages ----
app.get('/login', async (c) => {
	const url = new URL(c.req.url);
	const req = new Request(url.origin + '/login/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(req), 'html');
});

app.get('/signup', async (c) => {
	const url = new URL(c.req.url);
	const req = new Request(url.origin + '/signup/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(req), 'html');
});

app.get('/my', async (c) => {
	const url = new URL(c.req.url);
	const req = new Request(url.origin + '/my/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(req), 'html');
});

app.get('/forgot-password', async (c) => {
	const url = new URL(c.req.url);
	const req = new Request(url.origin + '/forgot-password/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(req), 'html');
});

app.get('/auth/reset-password', async (c) => {
	const url = new URL(c.req.url);
	const req = new Request(url.origin + '/auth/reset-password/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(req), 'html');
});

app.get('/', async (c) => {
	const url = new URL(c.req.url);
	const req = new Request(url.origin + '/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(req), 'html');
});

// ---- Static assets / 404 catch-all ----

app.all('*', async (c) => {
	const path = new URL(c.req.url).pathname;

	if (path.match(/\.(js|css|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$/)) {
		const extension = path.split('.').pop();
		return cacheStaticAsset(await c.env.ASSETS.fetch(c.req.raw), extension);
	}

	return c.json({ error: { code: 'not_found', message: 'The requested resource was not found' } }, 404);
});

export { RecentFeedDO } from './infrastructure/realtime/recentFeedDurableObject';

export default app;
