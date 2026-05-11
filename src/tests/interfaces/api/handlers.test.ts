import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHandlers } from '../../../interfaces/api/handlers';
import { CreatePasteCommand } from '../../../application/commands/createPasteCommand';
import { DeletePasteCommand, DeleteErrorCode } from '../../../application/commands/deletePasteCommand';
import { GetPasteQuery } from '../../../application/queries/getPasteQuery';
import { GetRecentPastesQuery } from '../../../application/queries/getRecentPastesQuery';
import { SearchPastesQuery } from '../../../application/queries/searchPastesQuery';
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
			mockGetQuery,
			mockRecentQuery,
			mockSearchQuery,
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
				mockGetQuery,
				mockRecentQuery,
				mockSearchQuery,
				mockLogger,
				undefined,
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
				mockGetQuery,
				mockRecentQuery,
				mockSearchQuery,
				mockLogger,
				undefined,
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
		it('should return 200 on successful delete', async () => {
			vi.mocked(mockDeleteCommand.execute).mockResolvedValue({
				success: true,
				message: 'Paste deleted successfully',
			});

			const req = new Request('https://example.com/pastes/abc123/delete?token=tok', {
				method: 'DELETE',
			});
			const res = await handlers.handleDeletePaste(req, 'abc123');

			expect(res.status).toBe(200);
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

		it('should return 403 when unauthorized', async () => {
			vi.mocked(mockDeleteCommand.execute).mockResolvedValue({
				success: false,
				errorCode: DeleteErrorCode.UNAUTHORIZED,
				message: 'Unauthorized',
			});

			const req = new Request('https://example.com/pastes/x/delete?token=bad', { method: 'DELETE' });
			const res = await handlers.handleDeletePaste(req, 'x');

			expect(res.status).toBe(403);
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
});
