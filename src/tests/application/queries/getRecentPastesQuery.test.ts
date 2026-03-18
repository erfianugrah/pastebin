import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetRecentPastesQuery } from '../../../application/queries/getRecentPastesQuery';
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

function makePaste(id: string, title: string, readCount = 0): Paste {
	return new Paste(
		PasteId.create(id),
		'content',
		new Date('2024-01-01T12:00:00Z'),
		ExpirationPolicy.create(86400),
		title,
		'javascript',
		'public',
		false,
		readCount,
	);
}

describe('GetRecentPastesQuery', () => {
	let query: GetRecentPastesQuery;

	beforeEach(() => {
		vi.resetAllMocks();
		query = new GetRecentPastesQuery(mockRepository);
	});

	it('should return an empty array when there are no pastes', async () => {
		vi.mocked(mockRepository.findRecentPublic).mockResolvedValue([]);

		const result = await query.execute(10);

		expect(result).toEqual([]);
		expect(mockRepository.findRecentPublic).toHaveBeenCalledWith(10);
	});

	it('should return formatted DTOs', async () => {
		const pastes = [
			makePaste('a', 'First', 5),
			makePaste('b', 'Second', 2),
		];
		vi.mocked(mockRepository.findRecentPublic).mockResolvedValue(pastes);

		const result = await query.execute(10);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			id: 'a',
			title: 'First',
			language: 'javascript',
			createdAt: '2024-01-01T12:00:00.000Z',
			expiresAt: expect.any(String),
			readCount: 5,
		});
	});

	it('should use "Untitled Paste" for pastes without titles', async () => {
		const paste = new Paste(
			PasteId.create('no-title'),
			'content',
			new Date(),
			ExpirationPolicy.create(3600),
			undefined, // no title
		);
		vi.mocked(mockRepository.findRecentPublic).mockResolvedValue([paste]);

		const result = await query.execute(5);

		expect(result[0].title).toBe('Untitled Paste');
	});

	it('should respect the limit parameter', async () => {
		vi.mocked(mockRepository.findRecentPublic).mockResolvedValue([]);

		await query.execute(25);

		expect(mockRepository.findRecentPublic).toHaveBeenCalledWith(25);
	});

	it('should default limit to 10', async () => {
		vi.mocked(mockRepository.findRecentPublic).mockResolvedValue([]);

		await query.execute();

		expect(mockRepository.findRecentPublic).toHaveBeenCalledWith(10);
	});
});
