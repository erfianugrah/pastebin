/**
 * Enhanced API middleware with comprehensive error handling
 * Implements the error handling infrastructure for API requests
 */
import { AppError, NetworkError, NotFoundError, ValidationError, RateLimitError, AuthError } from '../../infrastructure/errors/errorTypes';
import { ErrorCategory, categorizeError, getUserFriendlyMessage, logError } from '../../infrastructure/errors/errorHandler';
import { Logger } from '../../infrastructure/logging/logger';
import { ConfigurationService } from '../../infrastructure/config/config';
import { rateLimit } from '../../infrastructure/security/rateLimit';
import { cacheControl } from '../../infrastructure/caching/cacheControl';
import { Env } from '../../types';

/**
 * Middleware handler type definition
 */
export type MiddlewareHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response | null>;

/**
 * Context for request handling with additional properties
 */
export interface RequestContext {
  request: Request;
  env: Env;
  executionContext: ExecutionContext;
  config: ConfigurationService;
  logger: Logger;
  requestId: string;
  url: URL;
  params: Record<string, string>;
}

/**
 * Options for middleware configuration
 */
export interface MiddlewareOptions {
  enableLogging?: boolean;
  enableRateLimit?: boolean;
  enableCaching?: boolean;
  enableCors?: boolean;
  cacheTtl?: number;
  requestsPerMinute?: number;
}

/**
 * Apply multiple middleware handlers in sequence
 */
export function composeMiddleware(middlewares: MiddlewareHandler[]): MiddlewareHandler {
  return async (request: Request, env: Env, ctx: ExecutionContext) => {
    for (const middleware of middlewares) {
      const response = await middleware(request, env, ctx);
      if (response) return response;
    }
    return null;
  };
}

/**
 * Create request context with additional properties
 */
export function createRequestContext(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  logger: Logger,
  params: Record<string, string> = {}
): RequestContext {
  const config = new ConfigurationService(env);
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();

  // Set request context in logger
  logger.setContext({
    requestId,
    url: url.pathname,
    method: request.method,
    cf: request.cf,
    ...params
  });

  return {
    request,
    env,
    executionContext: ctx,
    config,
    logger,
    requestId,
    url,
    params,
  };
}

/**
 * Standard error response builder
 */
export function createErrorResponse(error: Error | unknown, status = 500): Response {
  // Default error structure
  let errorBody = {
    error: {
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
      code: 'internal_error',
    },
  };

  // If it's our application error, use its properties
  if (error instanceof AppError) {
    status = error.statusCode;
    errorBody = error.toJSON();
  } else {
    // For standard errors, categorize them and provide a more user-friendly message
    const category = categorizeError(error);
    const friendlyMessage = getUserFriendlyMessage(error);
    
    // Determine appropriate status code and error code based on category
    if (category === ErrorCategory.NETWORK) {
      status = 503;
      errorBody.error.code = 'network_error';
    } else if (category === ErrorCategory.VALIDATION) {
      status = 400;
      errorBody.error.code = 'validation_error';
    } else if (category === ErrorCategory.CRYPTO) {
      status = 400;
      errorBody.error.code = 'encryption_error';
    } else if (category === ErrorCategory.TIMEOUT) {
      status = 408;
      errorBody.error.code = 'timeout_error';
    }
    
    // Use the friendly message if available
    if (friendlyMessage) {
      errorBody.error.message = friendlyMessage;
    }
  }

  return new Response(JSON.stringify(errorBody), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Error handling middleware
 */
export function errorHandlerMiddleware(logger: Logger): MiddlewareHandler {
  return async (request, env, ctx) => {
    // This middleware doesn't block the request
    // It will catch errors thrown by later handlers
    return null;
  };
}

/**
 * Wrapper for handlers with automatic error handling
 */
export function withErrorHandling(
  handler: (context: RequestContext) => Promise<Response>,
  logger: Logger
): (context: RequestContext) => Promise<Response> {
  return async (context: RequestContext) => {
    try {
      return await handler(context);
    } catch (error) {
      // Log the error with context
      logError(error, {
        requestId: context.requestId,
        url: context.url.pathname,
        method: context.request.method,
        cf: context.request.cf,
      });

      // Add additional logging with the enhanced logger
      logger.error(`Error handling request: ${error instanceof Error ? error.message : String(error)}`, {
        error,
        requestId: context.requestId,
        path: context.url.pathname,
      });

      if (error instanceof NotFoundError) {
        return createErrorResponse(error, 404);
      } else if (error instanceof ValidationError) {
        return createErrorResponse(error, 400);
      } else if (error instanceof NetworkError) {
        return createErrorResponse(error, 503);
      } else if (error instanceof RateLimitError) {
        return createErrorResponse(error, 429);
      } else if (error instanceof AuthError) {
        return createErrorResponse(error, 401);
      } else if (error instanceof AppError) {
        return createErrorResponse(error, error.statusCode);
      } else {
        // For any other error, create a generic response
        const appError = new AppError(
          'An unexpected error occurred', 
          'internal_server_error', 
          500
        );
        return createErrorResponse(appError);
      }
    }
  };
}

/**
 * Logging middleware to record request information
 */
export function loggingMiddleware(logger: Logger): MiddlewareHandler {
  return async (request, env, ctx) => {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const startTime = Date.now();

    // Set up logging context
    logger.setContext({
      requestId,
      url: url.pathname,
      method: request.method,
      cf: request.cf,
    });

    // Log the request
    logger.info(`Request received: ${request.method} ${url.pathname}`);

    // Continue processing
    ctx.waitUntil(
      (async () => {
        try {
          // Wait for request to complete, then log the duration
          await ctx.passThroughOnException();
          const duration = Date.now() - startTime;
          logger.info(`Request completed in ${duration}ms`, { duration });
        } catch (error) {
          logger.error(`Error during request: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          // Clear logging context
          logger.clearContext();
        }
      })()
    );

    return null;
  };
}

/**
 * Rate limiting middleware
 */
export function rateLimitMiddleware(
  logger: Logger,
  options: { requestsPerMinute: number } = { requestsPerMinute: 60 }
): MiddlewareHandler {
  return async (request, env, ctx) => {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Skip rate limiting for certain paths
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/static/')) {
      return null;
    }

    try {
      // Apply rate limiting
      const rateLimited = await rateLimit(
        {
          ip,
          endpoint: url.pathname,
        },
        env,
        options.requestsPerMinute
      );

      if (rateLimited) {
        logger.warn(`Rate limit exceeded for IP: ${ip}`, { ip, path: url.pathname });
        
        // Create a rate limit error
        const error = new RateLimitError(
          'Too many requests. Please try again later.',
          'rate_limit_exceeded',
          429,
          { ip, path: url.pathname }
        );
        
        return createErrorResponse(error);
      }
    } catch (error) {
      // Log error but don't block the request on rate limit failures
      logger.error(`Rate limiting error: ${error instanceof Error ? error.message : String(error)}`, {
        ip,
        path: url.pathname,
      });
    }

    return null;
  };
}

/**
 * CORS middleware
 */
export function corsMiddleware(config: ConfigurationService): MiddlewareHandler {
  return async (request) => {
    // Handle preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(request, config),
      });
    }
    
    // For actual requests, add CORS headers in the next middleware
    return null;
  };
}

/**
 * Get CORS headers based on configuration
 */
function getCorsHeaders(request: Request, config: ConfigurationService): Headers {
  const headers = new Headers();
  const securityConfig = config.getSecurityConfig();
  
  const origin = request.headers.get('Origin');
  
  // If allowed origins is configured and not wildcard
  if (
    securityConfig.allowedOrigins &&
    securityConfig.allowedOrigins.length > 0 &&
    !securityConfig.allowedOrigins.includes('*')
  ) {
    // Check if request origin is in allowed origins
    if (origin && securityConfig.allowedOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
    }
  } else {
    // Otherwise allow any origin
    headers.set('Access-Control-Allow-Origin', '*');
  }
  
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, PUT, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization',
  );
  
  return headers;
}

/**
 * Security headers middleware
 */
export function securityHeadersMiddleware(): MiddlewareHandler {
  return async (request) => {
    // This middleware doesn't block the request
    // It adds security headers to the response later
    return null;
  };
}

/**
 * Add security headers to response
 */
export function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  
  // Add security headers
  headers.set('Content-Security-Policy', "default-src 'self'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  
  // Clone response with new headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Caching middleware
 */
export function cachingMiddleware(options: { ttl?: number } = {}): MiddlewareHandler {
  return async (request, env, ctx) => {
    const url = new URL(request.url);
    
    // Skip caching for non-GET requests or API endpoints
    if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
      return null;
    }

    try {
      // Apply caching headers based on the path
      const cacheTtl = options.ttl || cacheControl.getDefaultTtl(url.pathname);
      
      if (cacheTtl > 0) {
        ctx.waitUntil(
          (async () => {
            // This doesn't block the request, but ensures caching happens
            await cacheControl.setCacheHeaders(request, cacheTtl);
          })()
        );
      }
    } catch (error) {
      // Log error but don't block the request on caching failures
      console.error(`Caching error: ${error instanceof Error ? error.message : String(error)}`, {
        path: url.pathname,
      });
    }

    return null;
  };
}

/**
 * Create a middleware stack with default options
 */
export function createMiddleware(
  logger: Logger,
  config: ConfigurationService,
  options: MiddlewareOptions = {}
): MiddlewareHandler {
  const defaultOptions: Required<MiddlewareOptions> = {
    enableLogging: true,
    enableRateLimit: true,
    enableCaching: true,
    enableCors: true,
    cacheTtl: 0, // Use default TTL based on content type
    requestsPerMinute: 60,
  };

  const opts = { ...defaultOptions, ...options };
  const middlewares: MiddlewareHandler[] = [];

  // Always add error handling first
  middlewares.push(errorHandlerMiddleware(logger));

  // Add CORS middleware if enabled
  if (opts.enableCors) {
    middlewares.push(corsMiddleware(config));
  }

  // Add security headers middleware
  middlewares.push(securityHeadersMiddleware());

  // Add optional middleware based on configuration
  if (opts.enableLogging) {
    middlewares.push(loggingMiddleware(logger));
  }

  if (opts.enableRateLimit) {
    middlewares.push(rateLimitMiddleware(logger, { 
      requestsPerMinute: opts.requestsPerMinute 
    }));
  }

  if (opts.enableCaching) {
    middlewares.push(cachingMiddleware({ ttl: opts.cacheTtl }));
  }

  return composeMiddleware(middlewares);
}