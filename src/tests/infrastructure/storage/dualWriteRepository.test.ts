import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DualWriteRepository } from '../../../infrastructure/storage/dualWriteRepository';
import { Paste, PasteId, ExpirationPolicy } from '../../../domain/models/paste';
import { PasteRepository } from '../../../domain/repositories/pasteRepository';
import { Logger } from '../../../infrastructure/logging/logger';

// ---- Helpers ----

function makePaste(): Paste {
	return new Paste(
		PasteId.create('test-uuid'),
		'content',
		new Date('2024-01-01T12:00:00Z'),
		ExpirationPolicy.create(3600),
		'title',
		'typescript',
		'public',
		false,
		0,
		false,
		undefined,
		0,
		'delete-token',
	);
}

function makeRepo(): PasteRepository {
	return {
		save: vi.fn().mockResolvedValue(undefined),
		findById: vi.fn().mockResolvedValue(null),
		view: vi.fn().mockResolvedValue({ paste: null, wasBurned: false, wasViewLimited: false }),
		delete: vi.fn().mockResolvedValue(true),
		findRecentPublic: vi.fn().mockResolvedValue([]),
		searchPublic: vi.fn().mockResolvedValue([]),
		resolveSlug: vi.fn().mockResolvedValue(null),
		saveSlug: vi.fn().mockResolvedValue(undefined),
	};
}

const mockLogger = {
	trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
	warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
	setContext: vi.fn(), clearContext: vi.fn(),
} as unknown as Logger;

describe('DualWriteRepository', () => {
	let primary: PasteRepository;
	let secondary: PasteRepository;
	let repo: DualWriteRepository;

	beforeEach(() => {
		vi.resetAllMocks();
		primary = makeRepo();
		secondary = makeRepo();
		repo = new DualWriteRepository(primary, secondary, mockLogger);
	});

	// ---- Writes go to both ----

	describe('save', () => {
		it('writes to both primary and secondary', async () => {
			const paste = makePaste();
			await repo.save(paste);

			expect(primary.save).toHaveBeenCalledWith(paste);
			expect(secondary.save).toHaveBeenCalledWith(paste);
		});

		it('throws if primary fails', async () => {
			vi.mocked(primary.save).mockRejectedValue(new Error('KV error'));
			await expect(repo.save(makePaste())).rejects.toThrow('KV error');
		});

		it('does NOT throw if secondary fails -- logs instead', async () => {
			vi.mocked(secondary.save).mockRejectedValue(new Error('Supabase error'));
			await expect(repo.save(makePaste())).resolves.toBeUndefined();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('secondary save failed'),
				expect.objectContaining({ error: expect.any(Error) }),
			);
		});

		it('still writes to primary even if secondary fails', async () => {
			vi.mocked(secondary.save).mockRejectedValue(new Error('Supabase error'));
			await repo.save(makePaste());
			expect(primary.save).toHaveBeenCalled();
		});
	});

	describe('delete', () => {
		it('deletes from both primary and secondary', async () => {
			const id = PasteId.create('test-uuid');
			await repo.delete(id);

			expect(primary.delete).toHaveBeenCalledWith(id);
			expect(secondary.delete).toHaveBeenCalledWith(id);
		});

		it('returns primary result', async () => {
			vi.mocked(primary.delete).mockResolvedValue(true);
			vi.mocked(secondary.delete).mockResolvedValue(false);
			expect(await repo.delete(PasteId.create('test-uuid'))).toBe(true);
		});

		it('returns false if primary returns false', async () => {
			vi.mocked(primary.delete).mockResolvedValue(false);
			expect(await repo.delete(PasteId.create('nonexistent'))).toBe(false);
		});

		it('does NOT throw if secondary fails', async () => {
			vi.mocked(secondary.delete).mockRejectedValue(new Error('Supabase error'));
			await expect(repo.delete(PasteId.create('test-uuid'))).resolves.toBe(true);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});

	describe('saveSlug', () => {
		it('saves slug to both primary and secondary', async () => {
			const expiresAt = new Date('2024-01-01T13:00:00Z');
			await repo.saveSlug('my-slug', 'test-uuid', expiresAt);

			expect(primary.saveSlug).toHaveBeenCalledWith('my-slug', 'test-uuid', expiresAt);
			expect(secondary.saveSlug).toHaveBeenCalledWith('my-slug', 'test-uuid', expiresAt);
		});

		it('does NOT throw if secondary fails', async () => {
			vi.mocked(secondary.saveSlug).mockRejectedValue(new Error('Supabase error'));
			await expect(repo.saveSlug('slug', 'id', new Date())).resolves.toBeUndefined();
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});

	// ---- All reads come from primary only ----

	describe('reads come from primary only', () => {
		it('findById reads from primary only', async () => {
			const id = PasteId.create('test-uuid');
			await repo.findById(id);

			expect(primary.findById).toHaveBeenCalledWith(id);
			expect(secondary.findById).not.toHaveBeenCalled();
		});

		it('findRecentPublic reads from primary only', async () => {
			await repo.findRecentPublic(10);

			expect(primary.findRecentPublic).toHaveBeenCalledWith(10);
			expect(secondary.findRecentPublic).not.toHaveBeenCalled();
		});

		it('resolveSlug reads from primary only', async () => {
			await repo.resolveSlug('my-slug');

			expect(primary.resolveSlug).toHaveBeenCalledWith('my-slug');
			expect(secondary.resolveSlug).not.toHaveBeenCalled();
		});

		it('returns primary findById result', async () => {
			const paste = makePaste();
			vi.mocked(primary.findById).mockResolvedValue(paste);
			vi.mocked(secondary.findById).mockResolvedValue(null);

			const result = await repo.findById(PasteId.create('test-uuid'));
			expect(result).toBe(paste);
		});

		it('view reads/writes only to primary (no double-burn)', async () => {
			// Critical invariant: view() has side effects (read_count++,
			// possible delete). Shadow-viewing to secondary would burn the
			// paste twice. Verify secondary is never called.
			const paste = makePaste();
			vi.mocked(primary.view).mockResolvedValue({
				paste,
				wasBurned: false,
				wasViewLimited: false,
			});

			const result = await repo.view(PasteId.create('test-uuid'));

			expect(primary.view).toHaveBeenCalledWith(PasteId.create('test-uuid'));
			expect(secondary.view).not.toHaveBeenCalled();
			expect(result.paste).toBe(paste);
		});
	});
});
