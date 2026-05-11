import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabasePasteRepository } from '../../../infrastructure/storage/supabasePasteRepository';
import { Paste, PasteId, ExpirationPolicy } from '../../../domain/models/paste';
import { Logger } from '../../../infrastructure/logging/logger';

// ---- Shared test helpers ----

function makePaste(overrides: Partial<{
	id: string;
	content: string;
	visibility: 'public' | 'private';
	burnAfterReading: boolean;
	viewLimit: number | undefined;
	isEncrypted: boolean;
	version: number;
}> = {}): Paste {
	const id = PasteId.create(overrides.id ?? 'test-uuid-1234');
	const createdAt = new Date('2024-01-01T12:00:00Z');
	const expirationPolicy = ExpirationPolicy.create(3600);
	return new Paste(
		id,
		overrides.content ?? 'test content',
		createdAt,
		expirationPolicy,
		'Test Title',
		'typescript',
		overrides.visibility ?? 'public',
		overrides.burnAfterReading ?? false,
		0,
		overrides.isEncrypted ?? false,
		overrides.viewLimit,
		overrides.version ?? 0,
		'delete-token-uuid',
	);
}

function makeDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'test-uuid-1234',
		content: 'test content',
		title: 'Test Title',
		language: 'typescript',
		created_at: '2024-01-01T12:00:00.000Z',
		expires_at: '2024-01-01T13:00:00.000Z',
		updated_at: '2024-01-01T12:00:00.000Z',
		visibility: 'public',
		burn_after_reading: false,
		read_count: 0,
		is_encrypted: false,
		view_limit: null,
		version: 0,
		delete_token: 'delete-token-uuid',
		user_id: null,
		...overrides,
	};
}

// ---- Mock Supabase client ----

function makeSupabaseMock(overrides: {
	upsertResult?: { error: null | { message: string; code?: string } };
	selectResult?: { data: Record<string, unknown> | null; error: null | { message: string; code?: string } };
	deleteResult?: { error: null | { message: string }; count: number | null };
	queryResult?: { data: Record<string, unknown>[] | null; error: null | { message: string } };
	insertResult?: { error: null | { message: string } };
} = {}) {
	const from = vi.fn(() => ({
		upsert: vi.fn(() => Promise.resolve(overrides.upsertResult ?? { error: null })),
		select: vi.fn(() => ({
			eq: vi.fn(() => ({
				single: vi.fn(() => Promise.resolve(overrides.selectResult ?? { data: makeDbRow(), error: null })),
			})),
			// for findRecentPublic
			eq2: vi.fn(),
		})),
		delete: vi.fn(() => ({
			eq: vi.fn(() => Promise.resolve(overrides.deleteResult ?? { error: null, count: 1 })),
		})),
		insert: vi.fn(() => Promise.resolve(overrides.insertResult ?? { error: null })),
	}));

	return { from };
}

// ---- createClient mock ----

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => makeSupabaseMock()),
}));

import { createClient } from '@supabase/supabase-js';

const mockLogger = {
	trace: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	fatal: vi.fn(),
	setContext: vi.fn(),
	clearContext: vi.fn(),
} as unknown as Logger;

describe('SupabasePasteRepository', () => {
	let repository: SupabasePasteRepository;
	let mockClient: ReturnType<typeof makeSupabaseMock>;

	beforeEach(() => {
		vi.resetAllMocks();
		mockClient = makeSupabaseMock();
		vi.mocked(createClient).mockReturnValue(mockClient as any);
		repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);
	});

	describe('constructor', () => {
		it('creates a Supabase client with the provided URL and key', () => {
			expect(createClient).toHaveBeenCalledWith('https://test.supabase.co', 'sb_secret_test', {
				auth: {
					autoRefreshToken: false,
					persistSession: false,
					detectSessionInUrl: false,
				},
			});
		});
	});

	describe('save', () => {
		it('calls upsert with correct snake_case fields', async () => {
			const paste = makePaste();
			await repository.save(paste);

			const calls = mockClient.from.mock.calls as unknown[][];
			expect(calls[0][0]).toBe('pastes');

			const results = mockClient.from.mock.results as Array<{ value: ReturnType<typeof makeSupabaseMock>['from'] extends (...args: unknown[]) => infer R ? R : never }>;
			const upsertArg = (results[0].value.upsert.mock.calls as unknown[][])[0][0];
			expect(upsertArg).toMatchObject({
				id: 'test-uuid-1234',
				content: 'test content',
				title: 'Test Title',
				language: 'typescript',
				visibility: 'public',
				burn_after_reading: false,
				read_count: 0,
				is_encrypted: false,
				version: 0,
				delete_token: 'delete-token-uuid',
			});
		});

		it('throws if Supabase returns an error', async () => {
			mockClient = makeSupabaseMock({ upsertResult: { error: { message: 'DB error' } } });
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const paste = makePaste();
			await expect(repository.save(paste)).rejects.toThrow('Failed to save paste: DB error');
		});

		it('uses upsert not insert (save is called for updates too)', async () => {
			const paste = makePaste();
			await repository.save(paste);
			// Should call upsert, not insert
			expect(mockClient.from.mock.results[0].value.upsert).toHaveBeenCalled();
			expect(mockClient.from.mock.results[0].value.insert).not.toHaveBeenCalled();
		});
	});

	describe('findById', () => {
		it('returns a Paste when found', async () => {
			mockClient = makeSupabaseMock({ selectResult: { data: makeDbRow(), error: null } });
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.findById(PasteId.create('test-uuid-1234'));

			expect(result).not.toBeNull();
			expect(result?.getId().toString()).toBe('test-uuid-1234');
			expect(result?.getContent()).toBe('test content');
			expect(result?.getTitle()).toBe('Test Title');
			expect(result?.getLanguage()).toBe('typescript');
			expect(result?.getVisibility()).toBe('public');
		});

		it('returns null when paste not found (PGRST116)', async () => {
			mockClient = makeSupabaseMock({
				selectResult: { data: null, error: { message: 'no rows', code: 'PGRST116' } },
			});
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.findById(PasteId.create('nonexistent'));
			expect(result).toBeNull();
			expect(mockLogger.error).not.toHaveBeenCalled();
		});

		it('returns null and logs on unexpected error', async () => {
			mockClient = makeSupabaseMock({
				selectResult: { data: null, error: { message: 'connection error', code: '500' } },
			});
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.findById(PasteId.create('test-uuid-1234'));
			expect(result).toBeNull();
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it('maps all row fields correctly', async () => {
			const row = makeDbRow({
				burn_after_reading: true,
				read_count: 5,
				is_encrypted: true,
				view_limit: 10,
				version: 2,
				visibility: 'private',
			});
			mockClient = makeSupabaseMock({ selectResult: { data: row, error: null } });
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.findById(PasteId.create('test-uuid-1234'));
			expect(result?.isBurnAfterReading()).toBe(true);
			expect(result?.getReadCount()).toBe(5);
			expect(result?.getIsEncrypted()).toBe(true);
			expect(result?.getViewLimit()).toBe(10);
			expect(result?.getVersion()).toBe(2);
			expect(result?.getVisibility()).toBe('private');
		});
	});

	describe('delete', () => {
		it('returns true when a row is deleted', async () => {
			mockClient = makeSupabaseMock({ deleteResult: { error: null, count: 1 } });
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.delete(PasteId.create('test-uuid-1234'));
			expect(result).toBe(true);
		});

		it('returns false when no row was deleted (paste not found)', async () => {
			mockClient = makeSupabaseMock({ deleteResult: { error: null, count: 0 } });
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.delete(PasteId.create('nonexistent'));
			expect(result).toBe(false);
		});

		it('returns false and logs on error', async () => {
			mockClient = makeSupabaseMock({ deleteResult: { error: { message: 'DB error' }, count: null } });
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.delete(PasteId.create('test-uuid-1234'));
			expect(result).toBe(false);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});
});
