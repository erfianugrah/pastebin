import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeletePasteCommand, DeleteErrorCode } from '../../../application/commands/deletePasteCommand';
import { PasteRepository } from '../../../domain/repositories/pasteRepository';
import { Paste, PasteId, ExpirationPolicy } from '../../../domain/models/paste';

const mockRepository: PasteRepository = {
	save: vi.fn(),
	findById: vi.fn(),
	delete: vi.fn(),
	findRecentPublic: vi.fn(),
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
});
