/**
 * Example handler using the enhanced middleware and error handling
 * This demonstrates how to implement API handlers with proper error handling
 */
import { CreatePasteCommand } from '../../application/commands/createPasteCommand';
import { DeletePasteCommand } from '../../application/commands/deletePasteCommand';
import { GetPasteQuery } from '../../application/queries/getPasteQuery';
import { GetRecentPastesQuery } from '../../application/queries/getRecentPastesQuery';
import { ConfigurationService } from '../../infrastructure/config/config';
import { Logger } from '../../infrastructure/logging/logger';
import { Analytics } from '../../infrastructure/analytics/analytics';
import { Env } from '../../types';
import { 
  RequestContext, 
  withErrorHandling, 
  createRequestContext,
  createMiddleware,
  addSecurityHeaders
} from './enhanced-middleware';
import { 
  ValidationError,
  NotFoundError, 
  AuthError 
} from '../../infrastructure/errors/errorTypes';

/**
 * Example of how to create an API handler with comprehensive error handling
 */
export class EnhancedApiHandler {
  private logger: Logger;
  private config: ConfigurationService;
  private analytics: Analytics;
  
  constructor(
    private readonly createPasteCommand: CreatePasteCommand,
    private readonly deletePasteCommand: DeletePasteCommand,
    private readonly getPasteQuery: GetPasteQuery,
    private readonly getRecentPastesQuery: GetRecentPastesQuery,
    logger: Logger,
    private readonly env: Env,
  ) {
    this.logger = logger;
    this.config = new ConfigurationService();
    this.analytics = new Analytics(env, logger);
  }

  /**
   * Handle requests with middleware and error handling
   */
  async handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Create middleware stack
    const middleware = createMiddleware(this.logger, this.config, {
      enableLogging: true,
      enableRateLimit: true,
      enableCaching: true,
      enableCors: true,
      requestsPerMinute: 60
    });
    
    // Apply middleware
    const middlewareResponse = await middleware(request, env, ctx);
    if (middlewareResponse) {
      return middlewareResponse;
    }
    
    // Set up request context
    const reqContext = createRequestContext(request, env, ctx, this.logger);
    
    // Parse URL to determine route
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Route to appropriate handler with error handling
    let response: Response;
    
    if (path === '/api/pastes' && request.method === 'POST') {
      response = await withErrorHandling(this.handleCreatePaste.bind(this), this.logger)(reqContext);
    } else if (path.match(/^\/api\/pastes\/[^\/]+$/) && request.method === 'GET') {
      const pasteId = path.split('/').pop() || '';
      reqContext.params = { pasteId };
      response = await withErrorHandling(this.handleGetPaste.bind(this), this.logger)(reqContext);
    } else if (path.match(/^\/api\/pastes\/[^\/]+$/) && request.method === 'DELETE') {
      const pasteId = path.split('/').pop() || '';
      reqContext.params = { pasteId };
      response = await withErrorHandling(this.handleDeletePaste.bind(this), this.logger)(reqContext);
    } else if (path === '/api/pastes/recent' && request.method === 'GET') {
      response = await withErrorHandling(this.handleGetRecentPastes.bind(this), this.logger)(reqContext);
    } else {
      // Route not found
      response = new Response(
        JSON.stringify({
          error: {
            code: 'route_not_found',
            message: 'The requested endpoint does not exist',
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    
    // Add security headers to response
    return addSecurityHeaders(response);
  }

  /**
   * Handle create paste request with proper error handling
   */
  private async handleCreatePaste(context: RequestContext): Promise<Response> {
    const { request, logger } = context;
    
    logger.debug('Handling create paste request');

    // Parse request body
    const body = await request.json() as any;
    
    // Validate request - throw ValidationError for invalid data
    if (!body.content) {
      throw new ValidationError('Content is required');
    }
    
    if (body.content.length > 25 * 1024 * 1024) {
      throw new ValidationError(
        'Content is too large (max 25MB)', 
        'content_too_large', 
        400, 
        { maxSize: '25MB', providedSize: `${(body.content.length / (1024 * 1024)).toFixed(2)}MB` }
      );
    }

    // Execute command to create paste
    const result = await this.createPasteCommand.execute(body);
    
    // Track analytics event
    await this.analytics.trackEvent('paste_created', {
      id: result.id,
      language: body.language || 'plaintext',
      visibility: body.visibility || 'public',
      hasPassword: !!body.password,
    });

    // Return response
    return new Response(
      JSON.stringify(result),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Handle get paste request with proper error handling
   */
  private async handleGetPaste(context: RequestContext): Promise<Response> {
    const { params, logger } = context;
    const pasteId = params.pasteId;
    
    logger.debug('Handling get paste request', { pasteId });
    
    // First get the paste summary to check security status
    const summary = await this.getPasteQuery.executeSummary(pasteId);
    
    if (!summary) {
      throw new NotFoundError(`Paste "${pasteId}" not found or expired`);
    }
    
    // Get the encryption version and security type
    const version = summary.paste.getVersion();
    const securityType = summary.paste.getSecurityType();
    
    // Log the security information
    logger.debug('Paste security info', { 
      pasteId, 
      version, 
      securityType,
      isE2EEncrypted: summary.isE2EEncrypted,
      isEncrypted: summary.paste.getIsEncrypted()
    });
    
    // Check if this is an E2E encrypted paste (client-side only)
    if (summary.isE2EEncrypted || version === 2) {
      // For E2E encrypted pastes, we just return the encrypted content directly
      logger.debug('Returning E2E encrypted paste', { pasteId, version });
      
      // Track view
      await this.analytics.trackEvent('paste_viewed', {
        id: pasteId,
        language: summary.paste.getLanguage() || 'plaintext',
        visibility: summary.paste.getVisibility(),
        isEncrypted: true,
      });
      
      // Simply return the paste data with encrypted content
      return new Response(
        JSON.stringify(summary.paste.toJSON()), 
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Legacy paste handling
    if (version < 2) {
      logger.warn('Legacy paste access attempted', { pasteId, version, securityType });
      
      // Create a response about the encryption upgrade
      return new Response(
        JSON.stringify({
          error: {
            code: 'encryption_upgrade_required',
            message: 'This paste uses a legacy security method that is no longer supported.',
            details: {
              id: pasteId,
              title: summary.paste.getTitle(),
              language: summary.paste.getLanguage(),
              createdAt: summary.paste.getCreatedAt().toISOString(),
              expiresAt: summary.paste.getExpiresAt().toISOString(),
              securityUpgradeRequired: true,
              legacyVersion: version
            }
          }
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    
    // No password or encryption required, track view and return paste
    await this.analytics.trackEvent('paste_viewed', {
      id: pasteId,
      language: summary.paste.getLanguage() || 'plaintext',
      visibility: summary.paste.getVisibility(),
      passwordProtected: false,
      isEncrypted: false,
    });
    
    return new Response(
      JSON.stringify(summary.paste.toJSON()),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Handle delete paste request with proper error handling
   */
  private async handleDeletePaste(context: RequestContext): Promise<Response> {
    const { request, params, logger } = context;
    const pasteId = params.pasteId;
    
    logger.debug('Handling delete paste request', { pasteId });
    
    // Check if an owner token is provided
    let ownerToken: string | null = null;
    
    // Try to get owner token from query param
    const url = new URL(request.url);
    ownerToken = url.searchParams.get('token');
    
    // If no token in query params, check if request body has token
    if (!ownerToken && request.method === 'DELETE' && request.headers.get('Content-Type')?.includes('application/json')) {
      try {
        const body = await request.json() as { token?: string };
        ownerToken = body.token || null;
      } catch (e) {
        // Ignore parsing errors
      }
    }
    
    // Execute command to delete paste
    const result = await this.deletePasteCommand.execute({
      id: pasteId,
      ownerToken: ownerToken || undefined,
    });
    
    if (result.success) {
      // Track analytics event
      await this.analytics.trackEvent('paste_deleted', {
        id: pasteId
      });
      
      // Return success response
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } else {
      // Handle different error cases
      if (result.message === 'Paste not found') {
        throw new NotFoundError(`Paste "${pasteId}" not found or already deleted`);
      } else if (result.message === 'Unauthorized') {
        throw new AuthError('You are not authorized to delete this paste');
      } else {
        throw new Error(result.message);
      }
    }
  }

  /**
   * Handle get recent pastes request with proper error handling
   */
  private async handleGetRecentPastes(context: RequestContext): Promise<Response> {
    const { request, logger } = context;
    
    logger.debug('Handling get recent pastes request');
    
    // Get query params
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    
    // Execute query
    const results = await this.getRecentPastesQuery.execute(limit);
    
    // Return response
    return new Response(
      JSON.stringify({ pastes: results }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
}