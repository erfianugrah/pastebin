import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeletePasteCommand, DeleteErrorCode } from '../../../application/commands/deletePasteCommand';
import { PasteRepository } from '../../../domain/repositories/pasteRepository';
import { Paste, PasteId, ExpirationPolicy } from '../../../domain/models/paste';

const mockRepository: PasteRepository = {
	save: vi.fn(),
	findById: vi.fn(),
	view: vi.fn(),
	delete: vi.fn(),
	findRecentPublic: vi.fn(),
	searchPublic: vi.fn(),
	getPublicStats: vi.fn(),
	resolveSlug: vi.fn(),
	saveSlug: vi.fn(),
};

function makePaste(id: string, deleteToken = 'valid-token'): Paste {
	return new Paste(
		PasteId.create(id),
		'content',
		new Date(),
		ExpirationPolicy.create(3600),
		'title',
		undefined,
		'public',
		false,
		0,
		false,
		undefined,
		0,
		deleteToken,
	);
}

describe('DeletePasteCommand', () => {
	let command: DeletePasteCommand;

	beforeEach(() => {
		vi.resetAllMocks();
		command = new DeletePasteCommand(mockRepository);
	});

	it('should delete a paste with a valid token', async () => {
		const paste = makePaste('abc123', 'valid-token');
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);
		vi.mocked(mockRepository.delete).mockResolvedValue(true);

		const result = await command.execute({ id: 'abc123', ownerToken: 'valid-token' });

		expect(result.success).toBe(true);
		expect(result.errorCode).toBeUndefined();
		expect(mockRepository.delete).toHaveBeenCalledTimes(1);
	});

	it('should return NOT_FOUND when paste does not exist', async () => {
		vi.mocked(mockRepository.findById).mockResolvedValue(null);

		const result = await command.execute({ id: 'nonexistent' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.NOT_FOUND);
		expect(mockRepository.delete).not.toHaveBeenCalled();
	});

	it('should return UNAUTHORIZED when token does not match', async () => {
		const paste = makePaste('abc123', 'correct-token');
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await command.execute({ id: 'abc123', ownerToken: 'wrong-token' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.UNAUTHORIZED);
		expect(mockRepository.delete).not.toHaveBeenCalled();
	});

	it('should return UNAUTHORIZED when token is missing', async () => {
		const paste = makePaste('abc123', 'some-token');
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await command.execute({ id: 'abc123' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.UNAUTHORIZED);
	});

	it('should return FAILED when repository delete fails', async () => {
		const paste = makePaste('abc123', 'valid-token');
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);
		vi.mocked(mockRepository.delete).mockResolvedValue(false);

		const result = await command.execute({ id: 'abc123', ownerToken: 'valid-token' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.FAILED);
	});

	// [C4] Defense-in-depth: a row whose delete_token was somehow stored as
	// NULL or empty must NOT be deletable. Before the fix
	//   if (storedToken && storedToken !== validParams.ownerToken)
	// would short-circuit on a falsy storedToken and fall through to delete.
	it('returns UNAUTHORIZED when stored token is missing — falsy guard [C4]', async () => {
		const paste = new Paste(
			PasteId.create('orphan'),
			'content',
			new Date(),
			ExpirationPolicy.create(3600),
			'title',
			undefined,
			'public',
			false,
			0,
			false,
			undefined,
			0,
			undefined, // deleteToken = undefined — must still block delete
		);
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await command.execute({ id: 'orphan', ownerToken: 'any-token' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.UNAUTHORIZED);
		expect(mockRepository.delete).not.toHaveBeenCalled();
	});

	it('returns UNAUTHORIZED when stored token is empty string [C4]', async () => {
		const paste = new Paste(
			PasteId.create('emptytoken'),
			'content',
			new Date(),
			ExpirationPolicy.create(3600),
			'title',
			undefined,
			'public',
			false,
			0,
			false,
			undefined,
			0,
			'', // empty string — also falsy
		);
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await command.execute({ id: 'emptytoken', ownerToken: '' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.UNAUTHORIZED);
		expect(mockRepository.delete).not.toHaveBeenCalled();
	});
});
