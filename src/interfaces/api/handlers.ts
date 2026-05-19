import { CreatePasteCommand, CreatePasteParams } from '../../application/commands/createPasteCommand';
import { DeletePasteCommand, DeleteErrorCode } from '../../application/commands/deletePasteCommand';
import { UpdatePasteCommand, UpdateErrorCode } from '../../application/commands/updatePasteCommand';
import { GetPasteQuery } from '../../application/queries/getPasteQuery';
import { GetRecentPastesQuery } from '../../application/queries/getRecentPastesQuery';
import { SearchPastesQuery } from '../../application/queries/searchPastesQuery';
import { GetPasteStatsQuery } from '../../application/queries/getPasteStatsQuery';
import { AuthService } from '../../infrastructure/auth/authService';
import { Logger } from '../../infrastructure/logging/logger';
import { AppError, ValidationError, NotFoundError } from '../../infrastructure/errors/AppError';

/** Helper: build a JSON response */
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Parse the JSON body of a request. Throws AppError(400) on malformed JSON
 *  so callers don't need to wrap `request.json()` in their own try/catch and
 *  callers that previously surfaced SyntaxError as a 500 (via `app.onError`)
 *  now produce a structured 400 `bad_request`.
 */
async function parseJsonBody<T = unknown>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		throw new AppError('bad_request', 'Invalid JSON body', 400);
	}
}

/** Convert a Zod validation error (which has `issues`) into an AppError */
function rethrowIfZodError(error: unknown): void {
	if (error && typeof error === 'object' && 'issues' in error) {
		throw ValidationError('Invalid request data', { issues: (error as any).issues });
	}
}

/** Map DeleteErrorCode to HTTP status codes */
const DELETE_STATUS_MAP: Record<DeleteErrorCode, number> = {
	[DeleteErrorCode.NOT_FOUND]: 404,
	[DeleteErrorCode.UNAUTHORIZED]: 403,
	[DeleteErrorCode.FAILED]: 400,
};

/** Map UpdateErrorCode to HTTP status codes. Mirrors DELETE_STATUS_MAP. */
const UPDATE_STATUS_MAP: Record<UpdateErrorCode, number> = {
	[UpdateErrorCode.NOT_FOUND]: 404,
	[UpdateErrorCode.UNAUTHORIZED]: 403,
	[UpdateErrorCode.FAILED]: 400,
};

/** Maximum number of recent pastes that can be requested */
const MAX_RECENT_LIMIT = 100;

/** Maximum number of search results that can be returned in a single request */
const MAX_SEARCH_LIMIT = 50;

/** Maximum length of a search query (prevents pathological tsquery input) */
const MAX_SEARCH_QUERY_LEN = 200;

export class ApiHandlers {
	constructor(
		private readonly createPasteCommand: CreatePasteCommand,
		private readonly deletePasteCommand: DeletePasteCommand,
		private readonly updatePasteCommand: UpdatePasteCommand,
		private readonly getPasteQuery: GetPasteQuery,
		private readonly getRecentPastesQuery: GetRecentPastesQuery,
		private readonly searchPastesQuery: SearchPastesQuery,
		private readonly getPasteStatsQuery: GetPasteStatsQuery,
		private readonly logger: Logger,
		// authService is optional so test-injected handlers without auth
		// still work; production wiring in src/index.ts always passes it.
		private readonly authService?: AuthService,
	) {}

	async handleCreatePaste(request: Request): Promise<Response> {
		try {
			this.logger.debug('Handling create paste request');

			// Extract user_id from JWT if a Bearer token is present and valid.
			// Anonymous requests (no/invalid token) get userId = undefined and
			// produce anonymous pastes (user_id = NULL in DB).
			const userId = this.authService
				? (await this.authService.getUserIdFromRequest(request)) ?? undefined
				: undefined;

			const body = await parseJsonBody<CreatePasteParams>(request);
			const result = await this.createPasteCommand.execute(body, { userId });

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

			// The token MUST arrive in the JSON request body. We previously
			// also accepted it as `?token=<uuid>` — that surfaced the token
			// in browser history, Referer headers, and Cloudflare logpush
			// (request logger emits `Object.fromEntries(url.searchParams)`).
			// Any present `?token=` query param is now rejected with 400 so
			// the failure mode is loud rather than a silent log leak.
			const url = new URL(request.url);
			if (url.searchParams.has('token')) {
				return json(
					{
						error: {
							code: 'token_in_query',
							message: 'Send the delete token in the JSON request body, not as a query parameter.',
						},
					},
					400,
				);
			}

			let ownerToken: string | null = null;
			if (
				(request.method === 'DELETE' || request.method === 'POST') &&
				request.headers.get('Content-Type')?.includes('application/json')
			) {
				// Tolerant parse here: a missing body or malformed JSON on DELETE
				// is acceptable (caller may not have a token at all) — the
				// downstream command returns UNAUTHORIZED when ownerToken is null.
				try {
					const body = (await request.json()) as { token?: string };
					ownerToken = body.token || null;
				} catch {
					/* tolerate empty / malformed body — falls through to auth check */
				}
			}

			const result = await this.deletePasteCommand.execute({
				id: pasteId,
				ownerToken: ownerToken || undefined,
			});

			if (result.success) {
				return json(result);
			}

			// Use structured error code for status mapping
			const status = result.errorCode ? DELETE_STATUS_MAP[result.errorCode] : 400;

			return json({ error: { code: result.errorCode || 'unknown_error', message: result.message } }, status);
		} catch (error) {
			rethrowIfZodError(error);
			throw error;
		}
	}

	async handleUpdatePaste(request: Request, pasteId: string): Promise<Response> {
		try {
			this.logger.debug('Handling update paste request', { pasteId });

			// Body shape is enforced by UpdatePasteSchema inside the command.
			// We pass through the parsed JSON; the command's Zod parse rejects
			// non-string content, oversized payloads, bad UUIDs, etc.
			const body = await parseJsonBody<unknown>(request);

			const result = await this.updatePasteCommand.execute(pasteId, body as never);

			if (result.success) {
				return json({ success: true, id: pasteId });
			}

			const status = result.errorCode ? UPDATE_STATUS_MAP[result.errorCode] : 400;
			return json(
				{ error: { code: result.errorCode || 'unknown_error', message: result.message } },
				status,
			);
		} catch (error) {
			rethrowIfZodError(error);
			throw error;
		}
	}

	async handleGetRecentPastes(request: Request): Promise<Response> {
		this.logger.debug('Handling get recent pastes request');
		const url = new URL(request.url);
		const rawLimit = parseInt(url.searchParams.get('limit') || '10', 10);

		// Clamp limit to [1, MAX_RECENT_LIMIT]
		const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 10 : rawLimit, MAX_RECENT_LIMIT));

		const results = await this.getRecentPastesQuery.execute(limit);
		return json({ pastes: results });
	}

	async handleSearchPastes(request: Request): Promise<Response> {
		this.logger.debug('Handling search pastes request');
		const url = new URL(request.url);
		const rawQuery = (url.searchParams.get('q') ?? '').slice(0, MAX_SEARCH_QUERY_LEN);
		const query = rawQuery.trim();

		if (!query) {
			return json({ pastes: [], query: '' });
		}

		const rawLimit = parseInt(url.searchParams.get('limit') || '20', 10);
		const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, MAX_SEARCH_LIMIT));

		const results = await this.searchPastesQuery.execute(query, limit);
		return json({ pastes: results, query });
	}

	async handlePasteStats(_request: Request): Promise<Response> {
		this.logger.debug('Handling paste stats request');
		const stats = await this.getPasteStatsQuery.execute();
		if (!stats) {
			return json({ error: { code: 'unavailable', message: 'Stats not available on this backend' } }, 503);
		}
		return json(stats);
	}
}
