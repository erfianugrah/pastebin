import { Env } from './types';
import { ConfigurationService } from './infrastructure/config/config';
import { Logger } from './infrastructure/logging/logger';
import { KVPasteRepository } from './infrastructure/storage/kvPasteRepository';
import { CloudflareUniqueIdService } from './infrastructure/services/cloudflareUniqueIdService';
import { DefaultExpirationService } from './domain/services/expirationService';
import { CreatePasteCommand } from './application/commands/createPasteCommand';
import { DeletePasteCommand } from './application/commands/deletePasteCommand';
import { GetPasteQuery } from './application/queries/getPasteQuery';
import { AccessProtectedPasteQuery } from './application/queries/accessProtectedPasteQuery';
import { ApiHandlers } from './interfaces/api/handlers';
import { ApiMiddleware } from './interfaces/api/middleware';
import { HtmlRenderer } from './interfaces/ui/htmlRenderer';
import { errorHandler } from './infrastructure/errors/AppError';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Setup logging before the error handler so we have access to it
    const configService = new ConfigurationService({
      application: {
        name: 'pastebin',
        version: '1.0.0',
        baseUrl: new URL(request.url).origin,
      },
    });
  
    const logger = new Logger(configService, env);
    
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
        clientTcpRtt: cfData.clientTcpRtt
      }
    });
    
    // Log the request
    logger.info(`${request.method} ${url.pathname}`, {
      queryParams: Object.fromEntries(url.searchParams),
      headers: {
        'user-agent': request.headers.get('user-agent'),
        'content-type': request.headers.get('content-type'),
        'accept': request.headers.get('accept'),
      }
    });
    
    // Use global error handler with the logger
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

      const deletePasteCommand = new DeletePasteCommand(
        pasteRepository
      );
      
      const getPasteQuery = new GetPasteQuery(pasteRepository);
      const accessProtectedPasteQuery = new AccessProtectedPasteQuery(pasteRepository);
      
      // Create handlers and middleware
      const apiHandlers = new ApiHandlers(
        createPasteCommand,
        deletePasteCommand,
        getPasteQuery,
        accessProtectedPasteQuery,
        configService,
        logger,
        env
      );
      
      const apiMiddleware = new ApiMiddleware(configService, logger);
      const htmlRenderer = new HtmlRenderer();
      
      // Parse URL for use in routing and rate limiting
      const path = url.pathname;
      
      // Handle CORS
      const corsResponse = await apiMiddleware.handleCors(request);
      if (corsResponse) {
        return corsResponse;
      }
      
      // Check if this is a static asset request that should bypass rate limiting
      const isStaticAsset = path.match(/\.(js|css|svg|png|jpg|jpeg|gif|webp|ico|ttf|woff|woff2|eot|otf)$/);
      
      // Only apply rate limiting if not a static asset
      if (!isStaticAsset) {
        // Import the rate limit handler
        const { handleRateLimit } = await import('./infrastructure/security/rateLimit');
        
        // Apply stricter rate limiting for POST requests (paste creation)
        if (request.method === 'POST' && path === '/pastes') {
          const createLimitResponse = await handleRateLimit(request, env, {
            limit: 10, // 10 creations per minute
            pathPrefix: '/pastes',
          });
          if (createLimitResponse) {
            return createLimitResponse;
          }
        } else {
          // General rate limiting for API requests only
          const generalLimitResponse = await handleRateLimit(request, env, {
            limit: 60, // 60 requests per minute for general usage
          });
          if (generalLimitResponse) {
            return generalLimitResponse;
          }
        }
      }
      
      // Route request
      let response: Response;
      
      // Import caching utilities
      const { 
        addCacheHeaders, 
        cacheStaticAsset, 
        cachePasteView,
        preventCaching 
      } = await import('./infrastructure/caching/cacheControl');
      
      // Handle API routes
      if (path === '/pastes' && request.method === 'POST') {
        // Create paste (don't cache POST responses)
        response = await apiHandlers.handleCreatePaste(request);
        response = preventCaching(response);
      } else if (path === '/api/analytics' && request.method === 'GET') {
        // Analytics endpoint (admin only)
        // TODO: Add actual authentication for this endpoint
        response = await apiHandlers.handleGetAnalytics(request);
        response = preventCaching(response); // Don't cache analytics data
      } else if (path === '/api/logs' && request.method === 'GET') {
        // Logs endpoint (admin only)
        // TODO: Add actual authentication for this endpoint
        response = await apiHandlers.handleGetLogs(request);
        response = preventCaching(response); // Don't cache log data
      } else if (path === '/api/webhooks' && (request.method === 'GET' || request.method === 'POST')) {
        // Webhook management endpoints
        // TODO: Add actual authentication for this endpoint
        response = await apiHandlers.handleWebhooks(request);
        response = preventCaching(response); // Don't cache webhook data
      } else if (path.match(/^\/api\/webhooks\/([^\/]+)$/) && 
                (request.method === 'GET' || request.method === 'PUT' || 
                 request.method === 'PATCH' || request.method === 'DELETE')) {
        // Webhook operations for specific webhook ID
        const webhookId = path.split('/')[3];
        response = await apiHandlers.handleWebhookById(request, webhookId);
        response = preventCaching(response); // Don't cache webhook data
      } else if (path.match(/^\/pastes\/([^\/]+)\/delete$/) && (request.method === 'DELETE' || request.method === 'POST' || request.method === 'GET')) {
        // Delete paste endpoint - supports both DELETE and POST for broader compatibility
        // Extract paste ID from path - format: /pastes/{id}/delete
        const pasteId = path.split('/')[2];
        
        // Check if this is a DELETE API request or a page view request
        const acceptHeader = request.headers.get('Accept') || '';
        const wantsHtml = acceptHeader.includes('text/html');
        
        if (wantsHtml && request.method === 'GET') {
          // For HTML requests, serve the delete confirmation page
          const assetRequest = new Request(
            new URL(request.url).origin + '/pastes/index/delete/index.html',
            request
          );
          const htmlResponse = await env.ASSETS.fetch(assetRequest);
          
          // Set proper content type and caching
          return cacheStaticAsset(htmlResponse, 'html');
        } else {
          // Handle actual delete request
          response = await apiHandlers.handleDeletePaste(request, pasteId);
          response = preventCaching(response); // Don't cache delete responses
        }
      } else if (path === '/pastes/' && request.method === 'GET') {
        // Handle a request to /pastes/ with a trailing slash but no ID
        const acceptHeader = request.headers.get('Accept') || '';
        const wantsJson = acceptHeader.includes('application/json');
        
        if (wantsJson) {
          // For API requests, return a JSON response with public pastes
          // In the future, this could be a listing of public pastes
          return new Response(
            JSON.stringify({ 
              message: 'Paste ID is required',
              publicPastes: [] // In the future, we could populate this with actual public pastes
            }),
            { 
              status: 400, 
              headers: { 'Content-Type': 'application/json' } 
            },
          );
        } else {
          // For HTML requests, redirect to home
          return Response.redirect(new URL(request.url).origin, 302);
        }
      } else if (path === '/pastes' && request.method === 'GET') {
        // Handle requests to /pastes without trailing slash, same handling as with slash
        const acceptHeader = request.headers.get('Accept') || '';
        const wantsJson = acceptHeader.includes('application/json');
        
        if (wantsJson) {
          return new Response(
            JSON.stringify({ 
              message: 'Paste ID is required',
              publicPastes: [] 
            }),
            { 
              status: 400, 
              headers: { 'Content-Type': 'application/json' } 
            },
          );
        } else {
          return Response.redirect(new URL(request.url).origin, 302);
        }
      } else if (path.startsWith('/pastes/') && (request.method === 'GET' || request.method === 'POST')) {
        // Check if this is a request for the raw view
        const isRawView = path.includes('/raw/');
        
        // Extract paste ID from path
        let pasteId = '';
        if (isRawView) {
          // Format: /pastes/raw/abc123
          pasteId = path.split('/')[3];
        } else {
          // Format: /pastes/abc123
          pasteId = path.split('/')[2];
        }
        
        const acceptHeader = request.headers.get('Accept') || '';
        const wantsJson = acceptHeader.includes('application/json');
        
        if (wantsJson || isRawView) {
          // API request - supports both GET and POST (for password submission)
          response = await apiHandlers.handleGetPaste(request, pasteId);
          
          // For raw view requests, return the content as plain text
          if (isRawView && response.status === 200) {
            const responseData = await response.json() as {
              content: string;
              language?: string;
            };
            const contentType = responseData.language ? 
              `text/${responseData.language}` : 'text/plain';
              
            response = new Response(responseData.content, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=3600'
              }
            });
          }
          
          // Only cache successful responses and not password protected
          if (response.status === 200 && !isRawView) {
            response = cachePasteView(response);
          } else if (!isRawView) {
            response = preventCaching(response);
          }
        } else {
          // For HTML requests, rewrite to the index.html file that handles all routes
          // Astro generates a static site where /pastes/index/index.html handles all paste views
          const assetRequest = new Request(
            new URL(request.url).origin + '/pastes/index/index.html',
            request
          );
          const htmlResponse = await env.ASSETS.fetch(assetRequest);
          
          // Set proper content type and caching
          return cacheStaticAsset(htmlResponse, 'html');
        }
      } else if (path.match(/\.(js|css|svg|png|jpg|jpeg|gif|webp|ico)$/)) {
        // Static assets with aggressive caching
        const assetResponse = await env.ASSETS.fetch(request);
        
        // Extract file extension from path
        const extension = path.split('.').pop();
        
        // Apply caching and set proper content type
        return cacheStaticAsset(assetResponse, extension);
      } else if (path === '/recent') {
        // Recent page - serve the Astro-generated UI
        const recentRequest = new Request(
          new URL(request.url).origin + '/recent/index.html',
          request
        );
        const recentResponse = await env.ASSETS.fetch(recentRequest);
        
        // Set proper content type and caching
        return cacheStaticAsset(recentResponse, 'html');
      } else if (path === '/') {
        // Home page - serve the Astro-generated UI
        // Explicitly request the index.html file
        const homeRequest = new Request(
          new URL(request.url).origin + '/index.html',
          request
        );
        const homeResponse = await env.ASSETS.fetch(homeRequest);
        
        // Set proper content type and caching
        return cacheStaticAsset(homeResponse, 'html');
      } else {
        // Not found
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
          }
        );
      }
      
      // Add response headers
      return apiMiddleware.addResponseHeaders(response);
    }, logger); // Pass the logger to the error handler
  },
};