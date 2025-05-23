import { CreatePasteCommand, CreatePasteParams } from '../../application/commands/createPasteCommand';
import { DeletePasteCommand, DeletePasteParams } from '../../application/commands/deletePasteCommand';
import { GetPasteQuery } from '../../application/queries/getPasteQuery';
import { GetRecentPastesQuery } from '../../application/queries/getRecentPastesQuery';
import { ConfigurationService } from '../../infrastructure/config/config';
import { Logger } from '../../infrastructure/logging/logger';
import { Analytics } from '../../infrastructure/analytics/analytics';
import { WebhookService } from '../../infrastructure/webhooks/webhookService';
import { Env, AdminLogQuery } from '../../types';

export class ApiHandlers {
  private analytics: Analytics;
  private webhookService?: WebhookService;

  constructor(
    private readonly createPasteCommand: CreatePasteCommand,
    private readonly deletePasteCommand: DeletePasteCommand,
    private readonly getPasteQuery: GetPasteQuery,
    private readonly getRecentPastesQuery: GetRecentPastesQuery,
    private readonly configService: ConfigurationService,
    private readonly logger: Logger,
    private readonly env: Env,
  ) {
    this.analytics = new Analytics(env, logger);
    
    // Initialize webhook service if enabled in config
    if (env.WEBHOOKS && this.configService.get('enableWebhooks')) {
      this.webhookService = new WebhookService(logger, env.WEBHOOKS);
      // Initialize webhooks asynchronously
      this.webhookService.init().catch(error => {
        this.logger.error('Failed to initialize webhook service', { error });
      });
    }
  }

  async handleCreatePaste(request: Request): Promise<Response> {
    try {
      this.logger.debug('Handling create paste request');

      // Parse request body
      const body = await request.json() as CreatePasteParams;

      // Execute command to create paste
      const result = await this.createPasteCommand.execute(body);
      
      // Get the paste object for webhook payload
      const paste = await this.getPasteQuery.execute(result.id);

      // Track analytics event
      await this.analytics.trackEvent('paste_created', {
        id: result.id,
        language: body.language || 'plaintext',
        visibility: body.visibility || 'public',
        hasPassword: !!body.password,
      });
      
      // Trigger webhook if enabled
      if (this.webhookService && paste) {
        this.webhookService.pasteCreated(paste).catch(error => {
          this.logger.error('Failed to trigger webhook for paste creation', { error, pasteId: result.id });
        });
      }

      // Return response
      return new Response(
        JSON.stringify(result),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      this.logger.error('Error creating paste', { error });

      // Check if it's a validation error (from zod)
      // Note: In Zod 4, ZodError no longer extends Error but implements the Error interface
      if (error && typeof error === 'object' && 'issues' in error) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'validation_error',
              message: 'Invalid paste data',
              details: error.issues,
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
      
      // First get the paste summary to check security status
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
      
      // Get the encryption version and security type
      const version = summary.paste.getVersion();
      const securityType = summary.paste.getSecurityType();
      
      // Log the security information
      this.logger.debug('Paste security info', { 
        pasteId, 
        version, 
        securityType,
        isE2EEncrypted: summary.isE2EEncrypted,
        isEncrypted: summary.paste.getIsEncrypted()
      });
      
      // Check if this is an E2E encrypted paste (client-side only)
      if (summary.isE2EEncrypted || version === 2) {
        // For E2E encrypted pastes, we just return the encrypted content directly
        // No server-side password checking is needed - decryption happens client-side
        this.logger.debug('Returning E2E encrypted paste', { pasteId, version });
        
        // Track view
        await this.analytics.trackEvent('paste_viewed', {
          id: pasteId,
          language: summary.paste.getLanguage() || 'plaintext',
          visibility: summary.paste.getVisibility(),
          isEncrypted: true,
        });
        
        // Trigger webhook for paste view
        if (this.webhookService) {
          this.webhookService.pasteViewed(summary.paste).catch(error => {
            this.logger.error('Failed to trigger webhook for paste view', { error, pasteId });
          });
        }
        
        // Simply return the paste data with encrypted content
        // The client will handle decryption with the key from URL fragment or password input
        return new Response(JSON.stringify(summary.paste.toJSON()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Phase 4: If a pre-Phase 4 paste is accessed, upgrade it to use client-side encryption
      if (version < 2) {
        this.logger.warn('Legacy paste access attempted - server-side passwords are no longer supported', { 
          pasteId, 
          version, 
          securityType
        });
        
        // Create a response that informs the client about the encryption upgrade
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
      
      // Trigger webhook for paste view
      if (this.webhookService) {
        this.webhookService.pasteViewed(summary.paste).catch(error => {
          this.logger.error('Failed to trigger webhook for paste view', { error, pasteId });
        });
      }
      
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
        
        // Trigger webhook for paste deletion
        if (this.webhookService) {
          this.webhookService.pasteDeleted(pasteId).catch(error => {
            this.logger.error('Failed to trigger webhook for paste deletion', { error, pasteId });
          });
        }
        
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
      // Note: In Zod 4, ZodError no longer extends Error but implements the Error interface
      if (error && typeof error === 'object' && 'issues' in error) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'validation_error',
              message: 'Invalid delete request',
              details: error.issues,
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
  
  /**
   * Handle webhook management operations
   */
  async handleWebhooks(request: Request): Promise<Response> {
    // Ensure webhooks are enabled
    if (!this.webhookService) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'webhooks_disabled',
            message: 'Webhooks are not enabled for this instance',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    
    try {
      // List webhooks
      if (request.method === 'GET') {
        const endpoints = await this.webhookService.getEndpoints();
        return new Response(
          JSON.stringify({ endpoints }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      
      // Create webhook
      if (request.method === 'POST') {
        const data = await request.json() as any;
        const endpoint = await this.webhookService.registerEndpoint(data);
        return new Response(
          JSON.stringify(endpoint),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      
      // Method not allowed
      return new Response(
        JSON.stringify({
          error: {
            code: 'method_not_allowed',
            message: 'Method not allowed',
          },
        }),
        { status: 405, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      this.logger.error('Error handling webhooks request', { error });
      
      // Check if it's an AppError
      if (error instanceof Error && 'status' in (error as any)) {
        return new Response(
          JSON.stringify({
            error: {
              code: error.message.toLowerCase().replace(/\s+/g, '_'),
              message: error.message,
            },
          }),
          { status: (error as any).status || 500, headers: { 'Content-Type': 'application/json' } },
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
  
  /**
   * Get recent public pastes
   */
  async handleGetRecentPastes(request: Request): Promise<Response> {
    try {
      this.logger.debug('Handling get recent pastes request');
      
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
    } catch (error) {
      this.logger.error('Error getting recent pastes', { error });
      
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
   * Handle webhook operations for a specific webhook ID
   */
  async handleWebhookById(request: Request, id: string): Promise<Response> {
    // Ensure webhooks are enabled
    if (!this.webhookService) {
      return new Response(
        JSON.stringify({
          error: {
            code: 'webhooks_disabled',
            message: 'Webhooks are not enabled for this instance',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    
    try {
      // Get webhook details
      if (request.method === 'GET') {
        const endpoint = await this.webhookService.getEndpoint(id);
        if (!endpoint) {
          return new Response(
            JSON.stringify({
              error: {
                code: 'webhook_not_found',
                message: 'Webhook endpoint not found',
              },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
        
        return new Response(
          JSON.stringify(endpoint),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      
      // Update webhook
      if (request.method === 'PATCH' || request.method === 'PUT') {
        const data = await request.json() as any;
        const endpoint = await this.webhookService.updateEndpoint(id, data);
        return new Response(
          JSON.stringify(endpoint),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      
      // Delete webhook
      if (request.method === 'DELETE') {
        await this.webhookService.deleteEndpoint(id);
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      
      // Method not allowed
      return new Response(
        JSON.stringify({
          error: {
            code: 'method_not_allowed',
            message: 'Method not allowed',
          },
        }),
        { status: 405, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      this.logger.error('Error handling webhook by ID request', { error, webhookId: id });
      
      // Check if it's an AppError
      if (error instanceof Error && 'status' in (error as any)) {
        return new Response(
          JSON.stringify({
            error: {
              code: error.message.toLowerCase().replace(/\s+/g, '_'),
              message: error.message,
            },
          }),
          { status: (error as any).status || 500, headers: { 'Content-Type': 'application/json' } },
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