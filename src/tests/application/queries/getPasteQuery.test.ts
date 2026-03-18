import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetPasteQuery } from '../../../application/queries/getPasteQuery';
import { PasteRepository } from '../../../domain/repositories/pasteRepository';
import { Paste, PasteId, ExpirationPolicy } from '../../../domain/models/paste';

const mockRepository: PasteRepository = {
	save: vi.fn(),
	findById: vi.fn(),
	delete: vi.fn(),
	findRecentPublic: vi.fn(),
	resolveSlug: vi.fn(),
	saveSlug: vi.fn(),
};

function makePaste(
	id: string,
	opts: {
		expired?: boolean;
		burnAfterReading?: boolean;
		readCount?: number;
		viewLimit?: number;
	} = {},
): Paste {
	const createdAt = opts.expired
		? new Date(Date.now() - 7200 * 1000) // 2 hours ago
		: new Date();
	const expiration = ExpirationPolicy.create(opts.expired ? 3600 : 86400);

	return new Paste(
		PasteId.create(id),
		'content',
		createdAt,
		expiration,
		'title',
		undefined,
		'public',
		opts.burnAfterReading ?? false,
		opts.readCount ?? 0,
		false,
		opts.viewLimit,
		0,
		'delete-token',
	);
}

describe('GetPasteQuery', () => {
	let query: GetPasteQuery;

	beforeEach(() => {
		vi.resetAllMocks();
		query = new GetPasteQuery(mockRepository);
	});

	it('should return null for a non-existent paste', async () => {
		vi.mocked(mockRepository.findById).mockResolvedValue(null);

		const result = await query.execute('nonexistent');

		expect(result).toBeNull();
	});

	it('should return the paste and increment read count', async () => {
		const paste = makePaste('abc123');
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await query.execute('abc123');

		expect(result).not.toBeNull();
		expect(result!.getReadCount()).toBe(1);
		expect(mockRepository.save).toHaveBeenCalledTimes(1);
	});

	it('should delete and return null for an expired paste', async () => {
		const paste = makePaste('expired', { expired: true });
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await query.execute('expired');

		expect(result).toBeNull();
		expect(mockRepository.delete).toHaveBeenCalledTimes(1);
		expect(mockRepository.save).not.toHaveBeenCalled();
	});

	it('should return content then delete for burn-after-reading', async () => {
		const paste = makePaste('burn', { burnAfterReading: true });
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await query.execute('burn');

		expect(result).not.toBeNull();
		expect(result!.getContent()).toBe('content');
		// Should save (increment count) then delete
		expect(mockRepository.save).toHaveBeenCalledTimes(1);
		expect(mockRepository.delete).toHaveBeenCalledTimes(1);
	});

	it('should delete when view limit is reached', async () => {
		// readCount=4, viewLimit=5 -> after increment readCount=5 >= viewLimit -> delete
		const paste = makePaste('limited', { readCount: 4, viewLimit: 5 });
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await query.execute('limited');

		expect(result).not.toBeNull();
		expect(result!.getReadCount()).toBe(5);
		expect(mockRepository.delete).toHaveBeenCalledTimes(1);
	});

	it('should return null when view limit already exceeded', async () => {
		const paste = makePaste('over-limit', { readCount: 5, viewLimit: 5 });
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await query.execute('over-limit');

		expect(result).toBeNull();
		expect(mockRepository.delete).toHaveBeenCalledTimes(1);
		expect(mockRepository.save).not.toHaveBeenCalled();
	});

	it('should allow views when under the limit', async () => {
		const paste = makePaste('under-limit', { readCount: 2, viewLimit: 5 });
		vi.mocked(mockRepository.findById).mockResolvedValue(paste);

		const result = await query.execute('under-limit');

		expect(result).not.toBeNull();
		expect(result!.getReadCount()).toBe(3);
		// Saved but NOT deleted
		expect(mockRepository.save).toHaveBeenCalledTimes(1);
		expect(mockRepository.delete).not.toHaveBeenCalled();
	});

	describe('findById (read-only)', () => {
		it('should not increment read count', async () => {
			const paste = makePaste('abc123');
			vi.mocked(mockRepository.findById).mockResolvedValue(paste);

			const result = await query.findById('abc123');

			expect(result).not.toBeNull();
			expect(result!.getReadCount()).toBe(0);
			expect(mockRepository.save).not.toHaveBeenCalled();
		});
	});

	describe('executeSummary', () => {
		it('should identify E2E encrypted pastes', async () => {
			const paste = new Paste(
				PasteId.create('encrypted'),
				'cipher',
				new Date(),
				ExpirationPolicy.create(3600),
				undefined,
				undefined,
				'private',
				false,
				0,
				true, // isEncrypted
				undefined,
				2, // version = E2EE
			);
			vi.mocked(mockRepository.findById).mockResolvedValue(paste);

			const result = await query.executeSummary('encrypted');

			expect(result).not.toBeNull();
			expect(result!.isE2EEncrypted).toBe(true);
			expect(result!.requiresPassword).toBe(false);
		});
	});
});
