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
import { ApiMiddleware } from './interfaces/api/middleware';
import { errorHandler } from './infrastructure/errors/AppError';
import { initializeLogger } from './infrastructure/logging/loggerFactory';
import { handleRateLimit } from './infrastructure/security/rateLimit';
import { validateAdminAuth, createUnauthorizedResponse } from './infrastructure/auth/adminAuth';
import {
  addCacheHeaders,
  cacheStaticAsset,
  cachePasteView,
  preventCaching,
} from './infrastructure/caching/cacheControl';

/**
 * Helper that gates a handler behind admin Bearer-token auth and
 * prevents caching of the response.
 */
async function adminRoute(
  request: Request,
  env: Env,
  handler: () => Promise<Response>,
): Promise<Response> {
  const authResult = await validateAdminAuth(request, env as any);
  if (!authResult.success) {
    return createUnauthorizedResponse(authResult.error);
  }
  const response = await handler();
  return preventCaching(response);
}

/**
 * Handle GET /pastes or /pastes/ without a paste ID.
 */
function handlePastesIndex(request: Request): Response {
  const acceptHeader = request.headers.get('Accept') || '';
  const wantsJson = acceptHeader.includes('application/json');

  if (wantsJson) {
    return new Response(
      JSON.stringify({
        message: 'Paste ID is required',
        publicPastes: [],
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
  return Response.redirect(new URL(request.url).origin, 302);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const configService = new ConfigurationService({
      application: {
        name: 'pastebin',
        version: '1.0.0',
        baseUrl: new URL(request.url).origin,
      },
    });

    const logger = initializeLogger(configService, env);

    // Gather request details for logging context
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const cfData = request.cf || {};

    logger.setContext({
      requestId,
      url: request.url,
      method: request.method,
      path: url.pathname,
      cf: {
        country: cfData.country,
        colo: cfData.colo,
        asn: cfData.asn,
        clientTcpRtt: cfData.clientTcpRtt,
      },
    });

    logger.info(`${request.method} ${url.pathname}`, {
      queryParams: Object.fromEntries(url.searchParams),
      headers: {
        'user-agent': request.headers.get('user-agent'),
        'content-type': request.headers.get('content-type'),
        accept: request.headers.get('accept'),
      },
    });

    return errorHandler(request, ctx, async () => {
      // Create repository and services
      const pasteRepository = new KVPasteRepository(env.PASTES, logger);
      const uniqueIdService = new CloudflareUniqueIdService();
      const expirationService = new DefaultExpirationService();

      // Create commands and queries
      const createPasteCommand = new CreatePasteCommand(
        pasteRepository,
        uniqueIdService,
        expirationService,
        configService.getApplicationConfig().baseUrl,
      );

      const deletePasteCommand = new DeletePasteCommand(pasteRepository);
      const getPasteQuery = new GetPasteQuery(pasteRepository);
      const getRecentPastesQuery = new GetRecentPastesQuery(pasteRepository, logger);

      // Create handlers and middleware
      const apiHandlers = new ApiHandlers(
        createPasteCommand,
        deletePasteCommand,
        getPasteQuery,
        getRecentPastesQuery,
        configService,
        logger,
        env,
      );

      const apiMiddleware = new ApiMiddleware(configService, logger);

      const path = url.pathname;

      // Handle CORS preflight
      const corsResponse = await apiMiddleware.handleCors(request);
      if (corsResponse) {
        return corsResponse;
      }

      // Identify static assets to skip rate limiting
      const isStaticAsset =
        path.startsWith('/_astro/') ||
        path.startsWith('/assets/') ||
        path.startsWith('/prism-components/') ||
        (path.match(/\.(js|css|svg|png|jpg|jpeg|gif|webp|ico|ttf|woff|woff2|eot|otf)$/) &&
          !path.includes('/api/') &&
          !path.includes('/pastes/'));

      // Apply rate limiting to non-static requests
      if (!isStaticAsset) {
        if (request.method === 'POST' && path === '/pastes') {
          const limited = await handleRateLimit(request, env, {
            limit: 10,
            pathPrefix: '/pastes',
          });
          if (limited) return limited;
        } else {
          const limited = await handleRateLimit(request, env, { limit: 60 });
          if (limited) return limited;
        }
      }

      // ---------- Routing ----------

      let response: Response;

      // POST /pastes — create paste
      if (path === '/pastes' && request.method === 'POST') {
        response = preventCaching(await apiHandlers.handleCreatePaste(request));

      // GET /api/recent
      } else if (path === '/api/recent' && request.method === 'GET') {
        response = addCacheHeaders(await apiHandlers.handleGetRecentPastes(request), {
          maxAge: 60,
          staleWhileRevalidate: 300,
        });

      // Admin routes (all gated through adminRoute helper)
      } else if (path === '/api/analytics' && request.method === 'GET') {
        response = await adminRoute(request, env, () => apiHandlers.handleGetAnalytics(request));

      } else if (path === '/api/logs' && request.method === 'GET') {
        response = await adminRoute(request, env, () => apiHandlers.handleGetLogs(request));

      } else if (path === '/api/webhooks' && (request.method === 'GET' || request.method === 'POST')) {
        response = await adminRoute(request, env, () => apiHandlers.handleWebhooks(request));

      } else if (
        path.match(/^\/api\/webhooks\/([^\/]+)$/) &&
        ['GET', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
      ) {
        const webhookId = path.split('/')[3];
        response = await adminRoute(request, env, () =>
          apiHandlers.handleWebhookById(request, webhookId),
        );

      // Delete paste
      } else if (
        path.match(/^\/pastes\/([^\/]+)\/delete$/) &&
        (request.method === 'DELETE' || request.method === 'POST' || request.method === 'GET')
      ) {
        const pasteId = path.split('/')[2];
        const acceptHeader = request.headers.get('Accept') || '';

        if (acceptHeader.includes('text/html') && request.method === 'GET') {
          const assetRequest = new Request(
            url.origin + '/pastes/index/delete/index.html',
            request,
          );
          return cacheStaticAsset(await env.ASSETS.fetch(assetRequest), 'html');
        }
        response = preventCaching(await apiHandlers.handleDeletePaste(request, pasteId));

      // GET /pastes or /pastes/ without ID
      } else if ((path === '/pastes' || path === '/pastes/') && request.method === 'GET') {
        return handlePastesIndex(request);

      // GET|POST /pastes/:id or /pastes/raw/:id
      } else if (path.startsWith('/pastes/') && (request.method === 'GET' || request.method === 'POST')) {
        const isRawView = path.includes('/raw/');
        const pasteId = isRawView ? path.split('/')[3] : path.split('/')[2];
        const acceptHeader = request.headers.get('Accept') || '';
        const wantsJson = acceptHeader.includes('application/json');

        if (wantsJson || isRawView) {
          response = await apiHandlers.handleGetPaste(request, pasteId);

          if (isRawView && response.status === 200) {
            const responseData = (await response.json()) as { content: string };
            response = new Response(responseData.content, {
              status: 200,
              headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'public, max-age=3600',
              },
            });
          }

          if (response.status === 200 && !isRawView) {
            response = cachePasteView(response);
          } else if (!isRawView) {
            response = preventCaching(response);
          }
        } else {
          const assetRequest = new Request(url.origin + '/pastes/index/index.html', request);
          return cacheStaticAsset(await env.ASSETS.fetch(assetRequest), 'html');
        }

      // Static assets
      } else if (path.match(/\.(js|css|svg|png|jpg|jpeg|gif|webp|ico)$/)) {
        const extension = path.split('.').pop();
        return cacheStaticAsset(await env.ASSETS.fetch(request), extension);

      // Recent page
      } else if (path === '/recent') {
        const req = new Request(url.origin + '/recent/index.html', request);
        return cacheStaticAsset(await env.ASSETS.fetch(req), 'html');

      // Home page
      } else if (path === '/') {
        const req = new Request(url.origin + '/index.html', request);
        return cacheStaticAsset(await env.ASSETS.fetch(req), 'html');

      // 404
      } else {
        response = new Response(
          JSON.stringify({
            error: {
              code: 'not_found',
              message: 'The requested resource was not found',
            },
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return apiMiddleware.addResponseHeaders(response, request);
    }, logger);
  },
};
