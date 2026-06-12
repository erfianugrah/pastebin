import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeletePasteCommand, DeleteErrorCode } from '../../../application/commands/deletePasteCommand';
import { PasteRepository } from '../../../domain/repositories/pasteRepository';

const mockRepository: PasteRepository = {
	save: vi.fn(),
	findById: vi.fn(),
	view: vi.fn(),
	delete: vi.fn(),
	deleteWithToken: vi.fn(),
	updateWithToken: vi.fn(),
	findRecentPublic: vi.fn(),
	searchPublic: vi.fn(),
	getPublicStats: vi.fn(),
	resolveSlug: vi.fn(),
	claimSlug: vi.fn(),
};

describe('DeletePasteCommand', () => {
	let command: DeletePasteCommand;

	beforeEach(() => {
		vi.resetAllMocks();
		command = new DeletePasteCommand(mockRepository);
	});

	it('should delete a paste with a valid token', async () => {
		vi.mocked(mockRepository.deleteWithToken).mockResolvedValue({ found: true, deleted: true });

		const result = await command.execute({ id: 'abc123', ownerToken: 'valid-token' });

		expect(result.success).toBe(true);
		expect(result.errorCode).toBeUndefined();
		expect(mockRepository.deleteWithToken).toHaveBeenCalledTimes(1);
		expect(mockRepository.deleteWithToken).toHaveBeenCalledWith(expect.anything(), 'valid-token');
	});

	it('should return NOT_FOUND when paste does not exist', async () => {
		vi.mocked(mockRepository.deleteWithToken).mockResolvedValue({ found: false, deleted: false });

		const result = await command.execute({ id: 'nonexistent', ownerToken: 'any' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.NOT_FOUND);
	});

	it('should return UNAUTHORIZED when token does not match', async () => {
		vi.mocked(mockRepository.deleteWithToken).mockResolvedValue({ found: true, deleted: false });

		const result = await command.execute({ id: 'abc123', ownerToken: 'wrong-token' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.UNAUTHORIZED);
	});

	// [M20] Short-circuit: missing/empty token never reaches the DB. Saves
	// a round-trip and avoids leaking 404 vs 403 distinction on bogus calls.
	it('should return UNAUTHORIZED when token is missing without hitting the DB', async () => {
		const result = await command.execute({ id: 'abc123' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.UNAUTHORIZED);
		expect(mockRepository.deleteWithToken).not.toHaveBeenCalled();
	});

	it('should return UNAUTHORIZED when token is empty string without hitting the DB', async () => {
		const result = await command.execute({ id: 'abc123', ownerToken: '' });

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe(DeleteErrorCode.UNAUTHORIZED);
		expect(mockRepository.deleteWithToken).not.toHaveBeenCalled();
	});
});
