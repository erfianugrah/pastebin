import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHandlers } from '../../../interfaces/api/handlers';
import { CreatePasteCommand } from '../../../application/commands/createPasteCommand';
import { DeletePasteCommand, DeleteErrorCode } from '../../../application/commands/deletePasteCommand';
import { GetPasteQuery } from '../../../application/queries/getPasteQuery';
import { GetRecentPastesQuery } from '../../../application/queries/getRecentPastesQuery';
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
				requiresPassword: false,
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
});
