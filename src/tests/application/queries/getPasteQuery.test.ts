import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetPasteQuery } from '../../../application/queries/getPasteQuery';
import { PasteRepository, ViewResult } from '../../../domain/repositories/pasteRepository';
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

function makePaste(
	id: string,
	opts: {
		readCount?: number;
		isEncrypted?: boolean;
		version?: number;
	} = {},
): Paste {
	return new Paste(
		PasteId.create(id),
		'content',
		new Date(),
		ExpirationPolicy.create(86400),
		'title',
		undefined,
		'public',
		false,
		opts.readCount ?? 0,
		opts.isEncrypted ?? false,
		undefined,
		opts.version ?? 0,
		'delete-token',
	);
}

function viewResult(paste: Paste | null, opts: { wasBurned?: boolean; wasViewLimited?: boolean } = {}): ViewResult {
	return {
		paste,
		wasBurned: opts.wasBurned ?? false,
		wasViewLimited: opts.wasViewLimited ?? false,
	};
}

describe('GetPasteQuery', () => {
	let query: GetPasteQuery;

	beforeEach(() => {
		vi.resetAllMocks();
		query = new GetPasteQuery(mockRepository);
	});

	describe('execute', () => {
		it('delegates to repository.view and returns paste on success', async () => {
			const paste = makePaste('abc123', { readCount: 1 });
			vi.mocked(mockRepository.view).mockResolvedValue(viewResult(paste));

			const result = await query.execute('abc123');

			expect(result).toBe(paste);
			expect(mockRepository.view).toHaveBeenCalledWith(PasteId.create('abc123'));
			// Application no longer orchestrates -- repository does it atomically
			expect(mockRepository.findById).not.toHaveBeenCalled();
			expect(mockRepository.save).not.toHaveBeenCalled();
			expect(mockRepository.delete).not.toHaveBeenCalled();
		});

		it('returns null when repository reports not found', async () => {
			vi.mocked(mockRepository.view).mockResolvedValue(viewResult(null));

			const result = await query.execute('nonexistent');

			expect(result).toBeNull();
		});

		it('returns paste even when burned (caller still sees content)', async () => {
			const paste = makePaste('burned', { readCount: 1 });
			vi.mocked(mockRepository.view).mockResolvedValue(viewResult(paste, { wasBurned: true }));

			const result = await query.execute('burned');

			expect(result).toBe(paste);
		});

		it('returns paste even when view-limit reached on this view', async () => {
			const paste = makePaste('limited', { readCount: 5 });
			vi.mocked(mockRepository.view).mockResolvedValue(viewResult(paste, { wasViewLimited: true }));

			const result = await query.execute('limited');

			expect(result).toBe(paste);
		});
	});

	describe('findById (read-only)', () => {
		it('does not call view (no side effects)', async () => {
			const paste = makePaste('abc123');
			vi.mocked(mockRepository.findById).mockResolvedValue(paste);

			const result = await query.findById('abc123');

			expect(result).toBe(paste);
			expect(mockRepository.view).not.toHaveBeenCalled();
			expect(mockRepository.save).not.toHaveBeenCalled();
		});
	});

	describe('executeSummary', () => {
		it('identifies E2E encrypted pastes', async () => {
			const paste = makePaste('encrypted', { isEncrypted: true, version: 2 });
			vi.mocked(mockRepository.view).mockResolvedValue(viewResult(paste));

			const result = await query.executeSummary('encrypted');

			expect(result).not.toBeNull();
			expect(result!.isE2EEncrypted).toBe(true);
		});

		it('reports isE2EEncrypted=false for plaintext pastes', async () => {
			const paste = makePaste('plain', { isEncrypted: false, version: 0 });
			vi.mocked(mockRepository.view).mockResolvedValue(viewResult(paste));

			const result = await query.executeSummary('plain');

			expect(result!.isE2EEncrypted).toBe(false);
		});

		it('returns null when paste not found', async () => {
			vi.mocked(mockRepository.view).mockResolvedValue(viewResult(null));

			const result = await query.executeSummary('missing');

			expect(result).toBeNull();
		});
	});
});
