import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { ConfigurationService } from './infrastructure/config/config';
import { KVPasteRepository } from './infrastructure/storage/kvPasteRepository';
import { CloudflareUniqueIdService } from './infrastructure/services/cloudflareUniqueIdService';
import { DefaultExpirationService } from './domain/services/expirationService';
import { CreatePasteCommand } from './application/commands/createPasteCommand';
import { DeletePasteCommand } from './application/commands/deletePasteCommand';
import { GetPasteQuery } from './application/queries/getPasteQuery';
import { GetRecentPastesQuery } from './application/queries/getRecentPastesQuery';
import { ApiHandlers } from './interfaces/api/handlers';
import { securityHeaders } from './interfaces/api/middleware';
import { AppError } from './infrastructure/errors/AppError';
import { Logger } from './infrastructure/logging/logger';
import { addCacheHeaders, cacheStaticAsset, cachePasteView, preventCaching } from './infrastructure/caching/cacheControl';

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
	};
};

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
		queryParams: Object.fromEntries(url.searchParams),
		headers: {
			'user-agent': c.req.header('user-agent'),
			'content-type': c.req.header('content-type'),
			accept: c.req.header('accept'),
		},
	});

	c.set('requestId', requestId);
	c.set('logger', logger);

	// Create request-scoped services
	const configService = new ConfigurationService({
		application: {
			name: 'pastebin',
			version: '1.0.0',
			baseUrl: url.origin,
		},
	});

	const pasteRepository = new KVPasteRepository(c.env.PASTES, logger);

	const createPasteCommand = new CreatePasteCommand(
		pasteRepository,
		uniqueIdService,
		expirationService,
		configService.getApplicationConfig().baseUrl,
	);
	const deletePasteCommand = new DeletePasteCommand(pasteRepository);
	const getPasteQuery = new GetPasteQuery(pasteRepository);
	const getRecentPastesQuery = new GetRecentPastesQuery(pasteRepository, logger);

	const apiHandlers = new ApiHandlers(createPasteCommand, deletePasteCommand, getPasteQuery, getRecentPastesQuery, logger);

	c.set('handlers', apiHandlers);

	await next();
});

// 2. CORS — origin '*' WITHOUT credentials (fixes the open-CORS-with-credentials bug)
app.use(
	'*',
	cors({
		origin: '*',
		allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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
app.post('/pastes', async (c) => {
	return preventCaching(await c.get('handlers').handleCreatePaste(c.req.raw));
});

// GET /api/recent — recent public pastes
app.get('/api/recent', async (c) => {
	return addCacheHeaders(await c.get('handlers').handleGetRecentPastes(c.req.raw), {
		maxAge: 60,
		staleWhileRevalidate: 300,
	});
});

// DELETE|POST /pastes/:id/delete — delete paste (API)
app.on(['DELETE', 'POST'], '/pastes/:id/delete', async (c) => {
	const pasteId = c.req.param('id');
	return preventCaching(await c.get('handlers').handleDeletePaste(c.req.raw, pasteId));
});

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

// GET /pastes — index without an ID
app.get('/pastes', async (c) => {
	const accept = c.req.header('accept') || '';
	if (accept.includes('application/json')) {
		return c.json({ message: 'Paste ID is required', publicPastes: [] }, 400);
	}
	return c.redirect(new URL(c.req.url).origin, 302);
});

// GET /pastes/raw/:id — raw content
app.get('/pastes/raw/:id', async (c) => {
	const pasteId = c.req.param('id');
	const response = await c.get('handlers').handleGetPaste(c.req.raw, pasteId);

	if (response.status === 200) {
		const responseData = (await response.json()) as { content: string };
		return new Response(responseData.content, {
			status: 200,
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Cache-Control': 'public, max-age=3600',
			},
		});
	}
	return response;
});

// GET|POST /pastes/:id — view paste (JSON or HTML page)
app.on(['GET', 'POST'], '/pastes/:id', async (c) => {
	const pasteId = c.req.param('id');
	const accept = c.req.header('accept') || '';
	const wantsJson = accept.includes('application/json');

	if (wantsJson) {
		const response = await c.get('handlers').handleGetPaste(c.req.raw, pasteId);
		return response.status === 200 ? cachePasteView(response) : preventCaching(response);
	}

	// Serve the Astro-generated viewer page
	const url = new URL(c.req.url);
	const assetRequest = new Request(url.origin + '/pastes/index/index.html', c.req.raw);
	return cacheStaticAsset(await c.env.ASSETS.fetch(assetRequest), 'html');
});

// ---- Static pages ----

app.get('/recent', async (c) => {
	const url = new URL(c.req.url);
	const req = new Request(url.origin + '/recent/index.html', c.req.raw);
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

export default app;
