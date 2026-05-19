import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHandlers } from '../../../interfaces/api/handlers';
import { CreatePasteCommand } from '../../../application/commands/createPasteCommand';
import { DeletePasteCommand, DeleteErrorCode } from '../../../application/commands/deletePasteCommand';
import { UpdatePasteCommand, UpdateErrorCode } from '../../../application/commands/updatePasteCommand';
import { GetPasteQuery } from '../../../application/queries/getPasteQuery';
import { GetRecentPastesQuery } from '../../../application/queries/getRecentPastesQuery';
import { SearchPastesQuery } from '../../../application/queries/searchPastesQuery';
import { GetPasteStatsQuery } from '../../../application/queries/getPasteStatsQuery';
import { AuthService } from '../../../infrastructure/auth/authService';
import { Logger } from '../../../infrastructure/logging/logger';
import { Paste, PasteId, ExpirationPolicy } from '../../../domain/models/paste';

// ── Mocks ────────────────────────────────────────────────────────────

const mockCreateCommand = {
	execute: vi.fn(),
} as unknown as CreatePasteCommand;

const mockDeleteCommand = {
	execute: vi.fn(),
} as unknown as DeletePasteCommand;

const mockUpdateCommand = {
	execute: vi.fn(),
} as unknown as UpdatePasteCommand;

const mockGetQuery = {
	execute: vi.fn(),
	findById: vi.fn(),
	executeSummary: vi.fn(),
} as unknown as GetPasteQuery;

const mockRecentQuery = {
	execute: vi.fn(),
} as unknown as GetRecentPastesQuery;

const mockSearchQuery = {
	execute: vi.fn(),
} as unknown as SearchPastesQuery;

const mockStatsQuery = {
	execute: vi.fn(),
} as unknown as GetPasteStatsQuery;

const mockAuthService = {
	getUserIdFromRequest: vi.fn(),
} as unknown as AuthService;

const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	setContext: vi.fn(),
	clearContext: vi.fn(),
} as unknown as Logger;

// ── Helpers ──────────────────────────────────────────────────────────

function jsonRequest(url: string, body: unknown): Request {
	return new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

function getRequest(url: string): Request {
	return new Request(url, { headers: { Accept: 'application/json' } });
}

function makePaste(id: string): Paste {
	return new Paste(
		PasteId.create(id),
		'hello world',
		new Date(),
		ExpirationPolicy.create(3600),
		'Test Paste',
		'javascript',
		'public',
	);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ApiHandlers', () => {
	let handlers: ApiHandlers;

	beforeEach(() => {
		vi.resetAllMocks();
		handlers = new ApiHandlers(
			mockCreateCommand,
			mockDeleteCommand,
			mockUpdateCommand,
			mockGetQuery,
			mockRecentQuery,
			mockSearchQuery,
			mockStatsQuery,
			mockLogger,
		);
	});

	describe('handleCreatePaste', () => {
		it('should return 201 with paste data', async () => {
			vi.mocked(mockCreateCommand.execute).mockResolvedValue({
				id: 'abc123',
				url: 'https://example.com/pastes/abc123',
				expiresAt: new Date().toISOString(),
				deleteToken: 'tok',
			});

			const req = jsonRequest('https://example.com/pastes', {
				content: 'test',
				expiration: 3600,
			});
			const res = await handlers.handleCreatePaste(req);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body).toHaveProperty('id', 'abc123');
		});

		it('passes user_id from AuthService to the command when JWT is valid', async () => {
			vi.mocked(mockAuthService.getUserIdFromRequest).mockResolvedValue('user-uuid-789');
			vi.mocked(mockCreateCommand.execute).mockResolvedValue({
				id: 'abc',
				url: 'https://example.com/pastes/abc',
				expiresAt: new Date().toISOString(),
				deleteToken: 'tok',
			});

			handlers = new ApiHandlers(
				mockCreateCommand,
				mockDeleteCommand,
				mockUpdateCommand,
				mockGetQuery,
				mockRecentQuery,
				mockSearchQuery,
				mockStatsQuery,
				mockLogger,
				mockAuthService,
			);

			const req = new Request('https://example.com/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer some.jwt' },
				body: JSON.stringify({ content: 'authed', expiration: 3600 }),
			});
			await handlers.handleCreatePaste(req);

			expect(mockAuthService.getUserIdFromRequest).toHaveBeenCalledWith(req);
			expect(mockCreateCommand.execute).toHaveBeenCalledWith(
				expect.objectContaining({ content: 'authed' }),
				{ userId: 'user-uuid-789' },
			);
		});

		it('passes userId=undefined when no AuthService is configured', async () => {
			vi.mocked(mockCreateCommand.execute).mockResolvedValue({
				id: 'abc',
				url: 'https://example.com/pastes/abc',
				expiresAt: new Date().toISOString(),
				deleteToken: 'tok',
			});

			// Default test handler has no authService — should still work
			const req = jsonRequest('https://example.com/pastes', { content: 'anon', expiration: 3600 });
			await handlers.handleCreatePaste(req);

			expect(mockCreateCommand.execute).toHaveBeenCalledWith(
				expect.objectContaining({ content: 'anon' }),
				{ userId: undefined },
			);
		});

		it('passes userId=undefined when JWT is invalid', async () => {
			vi.mocked(mockAuthService.getUserIdFromRequest).mockResolvedValue(null);
			vi.mocked(mockCreateCommand.execute).mockResolvedValue({
				id: 'abc',
				url: 'https://example.com/pastes/abc',
				expiresAt: new Date().toISOString(),
				deleteToken: 'tok',
			});

			handlers = new ApiHandlers(
				mockCreateCommand,
				mockDeleteCommand,
				mockUpdateCommand,
				mockGetQuery,
				mockRecentQuery,
				mockSearchQuery,
				mockStatsQuery,
				mockLogger,
				mockAuthService,
			);

			const req = new Request('https://example.com/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bad.jwt' },
				body: JSON.stringify({ content: 'rejected', expiration: 3600 }),
			});
			await handlers.handleCreatePaste(req);

			expect(mockCreateCommand.execute).toHaveBeenCalledWith(
				expect.objectContaining({ content: 'rejected' }),
				{ userId: undefined },
			);
		});

		// [B6] Regression: malformed JSON used to bubble SyntaxError up to
		// app.onError which returned a generic 500. Should now be a
		// structured 400 bad_request.
		it('returns 400 bad_request on malformed JSON body', async () => {
			const req = new Request('https://example.com/pastes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{not json',
			});
			const res = await handlers.handleCreatePaste(req).catch((err) => {
				// AppError is thrown out of the handler; the global error
				// handler in src/index.ts converts it via toResponse().
				return err.toResponse?.() ?? err;
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error?.code).toBe('bad_request');
			expect(mockCreateCommand.execute).not.toHaveBeenCalled();
		});
	});

	describe('handleGetPaste', () => {
		it('should return 404 for non-existent paste', async () => {
			vi.mocked(mockGetQuery.executeSummary).mockResolvedValue(null);

			const req = getRequest('https://example.com/pastes/missing');
			await expect(handlers.handleGetPaste(req, 'missing')).rejects.toThrow();
		});

		it('should return paste JSON for unencrypted paste', async () => {
			const paste = makePaste('abc123');
			vi.mocked(mockGetQuery.executeSummary).mockResolvedValue({
				paste,
				isE2EEncrypted: false,
			});

			const req = getRequest('https://example.com/pastes/abc123');
			const res = await handlers.handleGetPaste(req, 'abc123');

			expect(res.status).toBe(200);
			const body = (await res.json()) as { id: string; content: string };
			expect(body.id).toBe('abc123');
			expect(body.content).toBe('hello world');
		});
	});

	describe('handleDeletePaste', () => {
		it('should return 200 on successful delete (body token)', async () => {
			vi.mocked(mockDeleteCommand.execute).mockResolvedValue({
				success: true,
				message: 'Paste deleted successfully',
			});

			const req = new Request('https://example.com/pastes/abc123/delete', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: 'tok' }),
			});
			const res = await handlers.handleDeletePaste(req, 'abc123');

			expect(res.status).toBe(200);
		});

		// [H2/M1] Delete token used to be accepted as `?token=<uuid>` which
		// landed in Cloudflare logpush via the global request-logger. We now
		// hard-reject the query-string path so the surface area shrinks to
		// "JSON body only".
		it('rejects `?token=` query param with 400 [H2]', async () => {
			const req = new Request('https://example.com/pastes/x/delete?token=leaked', {
				method: 'DELETE',
			});
			const res = await handlers.handleDeletePaste(req, 'x');

			expect(res.status).toBe(400);
			const body = (await res.json()) as { error?: { code?: string } };
			expect(body.error?.code).toBe('token_in_query');
			expect(mockDeleteCommand.execute).not.toHaveBeenCalled();
		});

		it('should return 404 when paste not found', async () => {
			vi.mocked(mockDeleteCommand.execute).mockResolvedValue({
				success: false,
				errorCode: DeleteErrorCode.NOT_FOUND,
				message: 'Paste not found',
			});

			const req = new Request('https://example.com/pastes/x/delete', { method: 'DELETE' });
			const res = await handlers.handleDeletePaste(req, 'x');

			expect(res.status).toBe(404);
		});

		it('should return 403 when unauthorized (body token mismatch)', async () => {
			vi.mocked(mockDeleteCommand.execute).mockResolvedValue({
				success: false,
				errorCode: DeleteErrorCode.UNAUTHORIZED,
				message: 'Unauthorized',
			});

			const req = new Request('https://example.com/pastes/x/delete', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: 'bad' }),
			});
			const res = await handlers.handleDeletePaste(req, 'x');

			expect(res.status).toBe(403);
		});

		// Regression: handler used to gate JSON-body reads on
		// `request.method === 'DELETE'`, so POST + body silently fell
		// through to query-param-only auth and always returned 403.
		// verify-realtime.ts hit this and leaked rt-* pastes for every
		// run. Cover both methods.
		it('reads token from JSON body on POST', async () => {
			vi.mocked(mockDeleteCommand.execute).mockResolvedValue({
				success: true,
				message: 'Paste deleted successfully',
			});

			const req = new Request('https://example.com/pastes/x/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: 'tok-via-post' }),
			});
			const res = await handlers.handleDeletePaste(req, 'x');

			expect(res.status).toBe(200);
			expect(mockDeleteCommand.execute).toHaveBeenCalledWith({
				id: 'x',
				ownerToken: 'tok-via-post',
			});
		});

		it('reads token from JSON body on DELETE', async () => {
			vi.mocked(mockDeleteCommand.execute).mockResolvedValue({
				success: true,
				message: 'Paste deleted successfully',
			});

			const req = new Request('https://example.com/pastes/x/delete', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: 'tok-via-delete' }),
			});
			const res = await handlers.handleDeletePaste(req, 'x');

			expect(res.status).toBe(200);
			expect(mockDeleteCommand.execute).toHaveBeenCalledWith({
				id: 'x',
				ownerToken: 'tok-via-delete',
			});
		});
	});

	describe('handleUpdatePaste', () => {
		// [B7-update] The old read-modify-write `handleUpdatePaste` would
		// `findById → new Paste(..., snapshot read_count) → repository.save()`.
		// `.save()` did an upsert, so any concurrent `view_paste` burn
		// between the read and the save would RESURRECT the burned paste.
		// The new path goes through `UpdatePasteCommand → updateWithToken`
		// which delegates to the `update_paste(uuid, uuid, …)` Postgres
		// RPC that takes `SELECT ... FOR UPDATE` and does a partial UPDATE
		// inside the same transaction — atomic and race-free.
		//
		// Tests below exercise the handler/command boundary; the race-
		// freedom itself is enforced by Postgres and verified at the
		// repository test level (the new `updateWithToken` is tested via
		// the supabasePasteRepository.test.ts mock).

		it('returns 200 on successful update via command', async () => {
			vi.mocked(mockUpdateCommand.execute).mockResolvedValue({
				success: true,
				message: 'Paste updated',
			});

			const req = new Request('https://example.com/pastes/abc', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					token: '12345678-1234-1234-1234-123456789012',
					content: 'updated content',
				}),
			});
			const res = await handlers.handleUpdatePaste(req, 'abc');

			expect(res.status).toBe(200);
			const body = (await res.json()) as { success: boolean; id: string };
			expect(body.success).toBe(true);
			expect(body.id).toBe('abc');
		});

		it('returns 404 when paste not found', async () => {
			vi.mocked(mockUpdateCommand.execute).mockResolvedValue({
				success: false,
				errorCode: UpdateErrorCode.NOT_FOUND,
				message: 'Paste not found',
			});

			const req = new Request('https://example.com/pastes/x', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					token: '12345678-1234-1234-1234-123456789012',
					content: 'x',
				}),
			});
			const res = await handlers.handleUpdatePaste(req, 'x');

			expect(res.status).toBe(404);
		});

		it('returns 403 on token mismatch', async () => {
			vi.mocked(mockUpdateCommand.execute).mockResolvedValue({
				success: false,
				errorCode: UpdateErrorCode.UNAUTHORIZED,
				message: 'Unauthorized',
			});

			const req = new Request('https://example.com/pastes/x', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					token: '00000000-0000-0000-0000-000000000000',
					content: 'x',
				}),
			});
			const res = await handlers.handleUpdatePaste(req, 'x');

			expect(res.status).toBe(403);
		});

		// Schema validation is exercised at the command level in
		// `tests/application/commands/updatePasteCommand.test.ts`. The
		// handler delegates to the command and just maps result codes to
		// HTTP statuses; tests at this layer mock the command and
		// therefore can't exercise Zod parsing. Keep the malformed-JSON
		// test below — that one IS handler-level (parseJsonBody throws
		// AppError before the command is invoked).

		it('returns 400 bad_request on malformed JSON body', async () => {
			const req = new Request('https://example.com/pastes/x', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: '{not json',
			});
			const res = await handlers
				.handleUpdatePaste(req, 'x')
				.catch((err) => err.toResponse?.() ?? err);

			expect(res.status).toBe(400);
			const body = (await res.json()) as { error?: { code?: string } };
			expect(body.error?.code).toBe('bad_request');
		});
	});

	describe('handleGetRecentPastes', () => {
		it('should return pastes with default limit', async () => {
			vi.mocked(mockRecentQuery.execute).mockResolvedValue([]);

			const req = getRequest('https://example.com/api/recent');
			const res = await handlers.handleGetRecentPastes(req);

			expect(res.status).toBe(200);
			expect(mockRecentQuery.execute).toHaveBeenCalledWith(10);
		});

		it('should clamp limit to [1, 100]', async () => {
			vi.mocked(mockRecentQuery.execute).mockResolvedValue([]);

			const req = getRequest('https://example.com/api/recent?limit=999');
			await handlers.handleGetRecentPastes(req);

			expect(mockRecentQuery.execute).toHaveBeenCalledWith(100);
		});

		it('should handle NaN limit gracefully', async () => {
			vi.mocked(mockRecentQuery.execute).mockResolvedValue([]);

			const req = getRequest('https://example.com/api/recent?limit=abc');
			await handlers.handleGetRecentPastes(req);

			expect(mockRecentQuery.execute).toHaveBeenCalledWith(10);
		});
	});

	describe('handleSearchPastes', () => {
		it('returns empty result without calling query when q is missing', async () => {
			const req = getRequest('https://example.com/api/search');
			const res = await handlers.handleSearchPastes(req);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { pastes: unknown[]; query: string };
			expect(body.pastes).toEqual([]);
			expect(body.query).toBe('');
			expect(mockSearchQuery.execute).not.toHaveBeenCalled();
		});

		it('returns empty result without calling query when q is whitespace', async () => {
			const req = getRequest('https://example.com/api/search?q=%20%20');
			await handlers.handleSearchPastes(req);

			expect(mockSearchQuery.execute).not.toHaveBeenCalled();
		});

		it('calls the search query with trimmed q and default limit', async () => {
			vi.mocked(mockSearchQuery.execute).mockResolvedValue([]);

			const req = getRequest('https://example.com/api/search?q=%20foo%20bar%20');
			const res = await handlers.handleSearchPastes(req);

			expect(res.status).toBe(200);
			expect(mockSearchQuery.execute).toHaveBeenCalledWith('foo bar', 20);
		});

		it('clamps limit to [1, 50]', async () => {
			vi.mocked(mockSearchQuery.execute).mockResolvedValue([]);

			const req = getRequest('https://example.com/api/search?q=x&limit=999');
			await handlers.handleSearchPastes(req);

			expect(mockSearchQuery.execute).toHaveBeenCalledWith('x', 50);
		});

		it('truncates pathologically long queries', async () => {
			vi.mocked(mockSearchQuery.execute).mockResolvedValue([]);
			const longQuery = 'a'.repeat(500);

			const req = getRequest(`https://example.com/api/search?q=${longQuery}`);
			await handlers.handleSearchPastes(req);

			// 200-char cap
			expect((mockSearchQuery.execute as any).mock.calls[0][0].length).toBe(200);
		});
	});

	describe('handlePasteStats', () => {
		it('returns the stats payload when the repo provides it', async () => {
			const fakeStats = {
				totalPublic: 7,
				byLanguage: [{ language: 'typescript', count: 5 }],
				byHour: [{ hour: '2026-05-11T15:00:00Z', count: 3 }],
				encryption: { '0': 7 },
				generatedAt: '2026-05-11T15:30:00Z',
			};
			vi.mocked(mockStatsQuery.execute).mockResolvedValue(fakeStats);

			const req = getRequest('https://example.com/api/stats');
			const res = await handlers.handlePasteStats(req);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual(fakeStats);
		});

		it('returns 503 when the repo returns null (backend has no aggregation)', async () => {
			vi.mocked(mockStatsQuery.execute).mockResolvedValue(null);

			const req = getRequest('https://example.com/api/stats');
			const res = await handlers.handlePasteStats(req);

			expect(res.status).toBe(503);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe('unavailable');
		});
	});
});
