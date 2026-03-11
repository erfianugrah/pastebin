import { CreatePasteCommand, CreatePasteParams } from '../../application/commands/createPasteCommand';
import { DeletePasteCommand } from '../../application/commands/deletePasteCommand';
import { GetPasteQuery } from '../../application/queries/getPasteQuery';
import { GetRecentPastesQuery } from '../../application/queries/getRecentPastesQuery';
import { ConfigurationService } from '../../infrastructure/config/config';
import { Logger } from '../../infrastructure/logging/logger';
import { AppError, ValidationError, NotFoundError } from '../../infrastructure/errors/AppError';

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
	constructor(
		private readonly createPasteCommand: CreatePasteCommand,
		private readonly deletePasteCommand: DeletePasteCommand,
		private readonly getPasteQuery: GetPasteQuery,
		private readonly getRecentPastesQuery: GetRecentPastesQuery,
		private readonly configService: ConfigurationService,
		private readonly logger: Logger,
	) {}

	async handleCreatePaste(request: Request): Promise<Response> {
		try {
			this.logger.debug('Handling create paste request');

			const body = (await request.json()) as CreatePasteParams;
			const result = await this.createPasteCommand.execute(body);

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
		return json(summary.paste.toJSON());
	}

	async handleDeletePaste(request: Request, pasteId: string): Promise<Response> {
		try {
			this.logger.debug('Handling delete paste request', { pasteId });

			let ownerToken: string | null = null;
			const url = new URL(request.url);
			ownerToken = url.searchParams.get('token');

			if (!ownerToken && request.method === 'DELETE' && request.headers.get('Content-Type')?.includes('application/json')) {
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
				return json(result);
			}

			const status = result.message === 'Paste not found' ? 404 : result.message === 'Unauthorized' ? 403 : 400;

			return json({ error: { code: result.message.toLowerCase().replace(/ /g, '_'), message: result.message } }, status);
		} catch (error) {
			rethrowIfZodError(error);
			throw error;
		}
	}

	async handleGetRecentPastes(request: Request): Promise<Response> {
		this.logger.debug('Handling get recent pastes request');
		const url = new URL(request.url);
		const limit = parseInt(url.searchParams.get('limit') || '10', 10);
		const results = await this.getRecentPastesQuery.execute(limit);
		return json({ pastes: results });
	}
}
