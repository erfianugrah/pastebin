import { CreatePasteCommand, CreatePasteParams } from '../../application/commands/createPasteCommand';
import { DeletePasteCommand, DeletePasteParams } from '../../application/commands/deletePasteCommand';
import { GetPasteQuery } from '../../application/queries/getPasteQuery';
import { AccessProtectedPasteQuery } from '../../application/queries/accessProtectedPasteQuery';
import { ConfigurationService } from '../../infrastructure/config/config';
import { Logger } from '../../infrastructure/logging/logger';
import { Analytics } from '../../infrastructure/analytics/analytics';
import { Env } from '../../types';

export class ApiHandlers {
  private analytics: Analytics;

  constructor(
    private readonly createPasteCommand: CreatePasteCommand,
    private readonly deletePasteCommand: DeletePasteCommand,
    private readonly getPasteQuery: GetPasteQuery,
    private readonly accessProtectedPasteQuery: AccessProtectedPasteQuery,
    private readonly configService: ConfigurationService,
    private readonly logger: Logger,
    private readonly env: Env,
  ) {
    this.analytics = new Analytics(env, logger);
  }

  async handleCreatePaste(request: Request): Promise<Response> {
    try {
      this.logger.debug('Handling create paste request');

      // Parse request body
      const body = await request.json() as CreatePasteParams;

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
    } catch (error) {
      this.logger.error('Error creating paste', { error });

      // Check if it's a validation error (from zod)
      if (error instanceof Error && 'issues' in (error as any)) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'validation_error',
              message: 'Invalid paste data',
              details: (error as any).issues,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Generic error
      return new Response(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'An internal error occurred',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  async handleGetPaste(request: Request, pasteId: string): Promise<Response> {
    try {
      this.logger.debug('Handling get paste request', { pasteId });
      
      // First get the paste summary to check if it requires a password
      const summary = await this.getPasteQuery.executeSummary(pasteId);
      
      if (!summary) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'paste_not_found',
              message: 'Paste not found or expired',
            },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      
      // If the paste requires a password
      if (summary.requiresPassword) {
        // Check if password was provided in request
        let password: string | null = null;
        
        // Try to get password from query param
        const url = new URL(request.url);
        password = url.searchParams.get('password');
        
        // If no password in query params, check if request body has password
        if (!password && request.method === 'POST') {
          try {
            const body = await request.json() as { password?: string };
            password = body.password || null;
          } catch (e) {
            // Ignore parsing errors
          }
        }
        
        if (!password) {
          // No password provided but paste is password-protected
          // Return a response indicating password is required, but don't show paste content
          this.logger.debug('Password required for paste', { pasteId });
          
          return new Response(
            JSON.stringify({
              id: pasteId,
              requiresPassword: true,
              title: summary.paste.getTitle(),
              language: summary.paste.getLanguage(),
              createdAt: summary.paste.getCreatedAt().toISOString(),
              expiresAt: summary.paste.getExpiresAt().toISOString(),
              visibility: summary.paste.getVisibility(),
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          );
        }
        
        // Try to access the protected paste with the provided password
        const paste = await this.accessProtectedPasteQuery.execute({
          id: pasteId,
          password: password || '',
        });
        
        if (!paste) {
          // Incorrect password
          this.logger.debug('Incorrect password for paste', { pasteId });
          
          return new Response(
            JSON.stringify({
              error: {
                code: 'invalid_password',
                message: 'Incorrect password',
              },
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          );
        }
        
        // Password correct, track view and return paste
        await this.analytics.trackEvent('paste_viewed', {
          id: pasteId,
          language: paste.getLanguage() || 'plaintext',
          visibility: paste.getVisibility(),
          passwordProtected: true,
        });
        
        return new Response(JSON.stringify(paste.toJSON()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // No password required, track view and return paste
      await this.analytics.trackEvent('paste_viewed', {
        id: pasteId,
        language: summary.paste.getLanguage() || 'plaintext',
        visibility: summary.paste.getVisibility(),
        passwordProtected: false,
      });
      
      return new Response(JSON.stringify(summary.paste.toJSON()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      this.logger.error('Error getting paste', { error, pasteId });
      
      return new Response(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'An internal error occurred',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  async handleGetAnalytics(request: Request): Promise<Response> {
    try {
      this.logger.debug('Handling get analytics request');
      
      // Get query params
      const url = new URL(request.url);
      const days = parseInt(url.searchParams.get('days') || '7', 10);
      
      // Get analytics data
      const stats = await this.analytics.getRecentStats(days);
      
      // Return response
      return new Response(
        JSON.stringify({ stats }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      this.logger.error('Error getting analytics', { error });
      
      return new Response(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'An internal error occurred',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
  
  /**
   * Retrieve system logs for admin viewing
   */
  async handleGetLogs(request: Request): Promise<Response> {
    try {
      this.logger.debug('Handling get logs request');
      
      // Get query params
      const url = new URL(request.url);
      const level = url.searchParams.get('level') as any; // Cast to LogLevel
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      
      // Parse date ranges if provided
      const startDateParam = url.searchParams.get('start');
      const endDateParam = url.searchParams.get('end');
      
      const startDate = startDateParam ? new Date(startDateParam) : undefined;
      const endDate = endDateParam ? new Date(endDateParam) : undefined;
      
      // Get logs using the Logger's getLogs method
      const logs = await this.logger.getLogs({
        level,
        limit,
        startDate,
        endDate,
      });
      
      // Return response
      return new Response(
        JSON.stringify({ logs }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      this.logger.error('Error getting logs', { error });
      
      return new Response(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'An internal error occurred',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  /**
   * Handle delete paste request
   */
  async handleDeletePaste(request: Request, pasteId: string): Promise<Response> {
    try {
      this.logger.debug('Handling delete paste request', { pasteId });
      
      // Check if an owner token is provided (future enhancement)
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
        // Return error response based on message
        const status = result.message === 'Paste not found' ? 404 : 
                       result.message === 'Unauthorized' ? 403 : 400;
                       
        return new Response(
          JSON.stringify({
            error: {
              code: result.message.toLowerCase().replace(' ', '_'),
              message: result.message,
            },
          }),
          { status, headers: { 'Content-Type': 'application/json' } },
        );
      }
    } catch (error) {
      this.logger.error('Error deleting paste', { error, pasteId });
      
      // Check if it's a validation error
      if (error instanceof Error && 'issues' in (error as any)) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'validation_error',
              message: 'Invalid delete request',
              details: (error as any).issues,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      
      // Generic error
      return new Response(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message: 'An internal error occurred',
          },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
}