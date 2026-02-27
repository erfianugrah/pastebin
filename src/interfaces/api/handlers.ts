import { CreatePasteCommand, CreatePasteParams } from '../../application/commands/createPasteCommand';
import { DeletePasteCommand } from '../../application/commands/deletePasteCommand';
import { GetPasteQuery } from '../../application/queries/getPasteQuery';
import { GetRecentPastesQuery } from '../../application/queries/getRecentPastesQuery';
import { ConfigurationService } from '../../infrastructure/config/config';
import { Logger } from '../../infrastructure/logging/logger';
import { Analytics } from '../../infrastructure/analytics/analytics';
import { WebhookService } from '../../infrastructure/webhooks/webhookService';
import { AppError, ValidationError, NotFoundError } from '../../infrastructure/errors/AppError';
import { Env } from '../../types';

/** Helper: build a JSON response */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Convert a Zod validation error (which has `issues`) into an AppError */
function rethrowIfZodError(error: unknown): void {
  if (error && typeof error === 'object' && 'issues' in error) {
    throw ValidationError('Invalid request data', { issues: (error as any).issues });
  }
}

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

    const enableWebhooks =
      this.configService.get('enableWebhooks') ?? (env.WEBHOOKS ? true : false);

    if (env.WEBHOOKS && enableWebhooks) {
      this.webhookService = new WebhookService(logger, env.WEBHOOKS);
      this.webhookService.init().catch(error => {
        this.logger.error('Failed to initialize webhook service', { error });
      });
    }
  }

  private requireWebhookService(): WebhookService {
    if (!this.webhookService) {
      throw new AppError('webhooks_disabled', 'Webhooks are not enabled for this instance', 400);
    }
    return this.webhookService;
  }

  async handleCreatePaste(request: Request): Promise<Response> {
    try {
      this.logger.debug('Handling create paste request');

      const body = (await request.json()) as CreatePasteParams;
      const result = await this.createPasteCommand.execute(body);

      // Read-only fetch for webhook payload (no view increment)
      const paste = await this.getPasteQuery.findById(result.id);

      await this.analytics.trackEvent('paste_created', {
        id: result.id,
        language: body.language || 'plaintext',
        visibility: body.visibility || 'public',
        hasPassword: !!body.password,
      });

      if (this.webhookService && paste) {
        this.webhookService.pasteCreated(paste).catch(error => {
          this.logger.error('Failed to trigger webhook for paste creation', { error, pasteId: result.id });
        });
      }

      return json(result, 201);
    } catch (error) {
      rethrowIfZodError(error);
      throw error;
    }
  }

  async handleGetPaste(request: Request, pasteId: string): Promise<Response> {
    this.logger.debug('Handling get paste request', { pasteId });

    const summary = await this.getPasteQuery.executeSummary(pasteId);

    if (!summary) {
      throw NotFoundError('Paste not found or expired');
    }

    const version = summary.paste.getVersion();

    // E2E encrypted paste — return encrypted content directly
    if (summary.isE2EEncrypted || version === 2) {
      this.logger.debug('Returning E2E encrypted paste', { pasteId, version });

      await this.analytics.trackEvent('paste_viewed', {
        id: pasteId,
        language: summary.paste.getLanguage() || 'plaintext',
        visibility: summary.paste.getVisibility(),
        isEncrypted: true,
      });

      if (this.webhookService) {
        this.webhookService.pasteViewed(summary.paste).catch(error => {
          this.logger.error('Failed to trigger webhook for paste view', { error, pasteId });
        });
      }

      return json(summary.paste.toJSON());
    }

    // Legacy encrypted paste — no longer supported
    if (version < 2 && summary.paste.getIsEncrypted()) {
      this.logger.warn('Legacy paste access attempted', { pasteId, version });

      throw new AppError('encryption_upgrade_required', 'This paste uses a legacy security method that is no longer supported.', 400, {
        id: pasteId,
        title: summary.paste.getTitle(),
        language: summary.paste.getLanguage(),
        createdAt: summary.paste.getCreatedAt().toISOString(),
        expiresAt: summary.paste.getExpiresAt().toISOString(),
        securityUpgradeRequired: true,
        legacyVersion: version,
      });
    }

    // Unencrypted paste
    await this.analytics.trackEvent('paste_viewed', {
      id: pasteId,
      language: summary.paste.getLanguage() || 'plaintext',
      visibility: summary.paste.getVisibility(),
      isEncrypted: false,
    });

    if (this.webhookService) {
      this.webhookService.pasteViewed(summary.paste).catch(error => {
        this.logger.error('Failed to trigger webhook for paste view', { error, pasteId });
      });
    }

    return json(summary.paste.toJSON());
  }

  async handleGetAnalytics(request: Request): Promise<Response> {
    this.logger.debug('Handling get analytics request');
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '7', 10);
    const stats = await this.analytics.getRecentStats(days);
    return json({ stats });
  }

  async handleGetLogs(request: Request): Promise<Response> {
    this.logger.debug('Handling get logs request');
    const url = new URL(request.url);
    const level = url.searchParams.get('level') as any;
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const startDateParam = url.searchParams.get('start');
    const endDateParam = url.searchParams.get('end');
    const startDate = startDateParam ? new Date(startDateParam) : undefined;
    const endDate = endDateParam ? new Date(endDateParam) : undefined;

    const logs = await this.logger.getLogs({ level, limit, startDate, endDate });
    return json({ logs });
  }

  async handleDeletePaste(request: Request, pasteId: string): Promise<Response> {
    try {
      this.logger.debug('Handling delete paste request', { pasteId });

      let ownerToken: string | null = null;
      const url = new URL(request.url);
      ownerToken = url.searchParams.get('token');

      if (
        !ownerToken &&
        request.method === 'DELETE' &&
        request.headers.get('Content-Type')?.includes('application/json')
      ) {
        try {
          const body = (await request.json()) as { token?: string };
          ownerToken = body.token || null;
        } catch {
          // Ignore JSON parsing errors
        }
      }

      const result = await this.deletePasteCommand.execute({
        id: pasteId,
        ownerToken: ownerToken || undefined,
      });

      if (result.success) {
        await this.analytics.trackEvent('paste_deleted', { id: pasteId });

        if (this.webhookService) {
          this.webhookService.pasteDeleted(pasteId).catch(error => {
            this.logger.error('Failed to trigger webhook for paste deletion', { error, pasteId });
          });
        }

        return json(result);
      }

      const status =
        result.message === 'Paste not found' ? 404 : result.message === 'Unauthorized' ? 403 : 400;

      return json(
        { error: { code: result.message.toLowerCase().replace(/ /g, '_'), message: result.message } },
        status,
      );
    } catch (error) {
      rethrowIfZodError(error);
      throw error;
    }
  }

  async handleWebhooks(request: Request): Promise<Response> {
    const service = this.requireWebhookService();

    if (request.method === 'GET') {
      const endpoints = await service.getEndpoints();
      return json({ endpoints });
    }

    if (request.method === 'POST') {
      const data = (await request.json()) as any;
      const endpoint = await service.registerEndpoint(data);
      return json(endpoint, 201);
    }

    return json({ error: { code: 'method_not_allowed', message: 'Method not allowed' } }, 405);
  }

  async handleGetRecentPastes(request: Request): Promise<Response> {
    this.logger.debug('Handling get recent pastes request');
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    const results = await this.getRecentPastesQuery.execute(limit);
    return json({ pastes: results });
  }

  async handleWebhookById(request: Request, id: string): Promise<Response> {
    const service = this.requireWebhookService();

    if (request.method === 'GET') {
      const endpoint = await service.getEndpoint(id);
      if (!endpoint) {
        throw NotFoundError('Webhook endpoint not found');
      }
      return json(endpoint);
    }

    if (request.method === 'PATCH' || request.method === 'PUT') {
      const data = (await request.json()) as any;
      const endpoint = await service.updateEndpoint(id, data);
      return json(endpoint);
    }

    if (request.method === 'DELETE') {
      await service.deleteEndpoint(id);
      return json({ success: true });
    }

    return json({ error: { code: 'method_not_allowed', message: 'Method not allowed' } }, 405);
  }
}
