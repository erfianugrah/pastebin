import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __resetSupabaseClientCache } from '../../../infrastructure/supabase/getSupabaseClient';
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
	rpcResult?: { data: unknown; error: null | { message: string; code?: string } };
	searchResult?: { data: Record<string, unknown>[] | null; error: null | { message: string } };
} = {}) {
	// searchPublic chains: .from().select().eq().gt().textSearch().order().limit()
	// Each call returns the next chainable; the final await gets the result.
	const searchTerminator = Promise.resolve(overrides.searchResult ?? { data: [], error: null });
	const searchChain = {
		eq: vi.fn(() => searchChain),
		gt: vi.fn(() => searchChain),
		textSearch: vi.fn(() => searchChain),
		order: vi.fn(() => searchChain),
		limit: vi.fn(() => searchTerminator),
		single: vi.fn(() => Promise.resolve(overrides.selectResult ?? { data: makeDbRow(), error: null })),
	};

	const from = vi.fn(() => ({
		upsert: vi.fn(() => Promise.resolve(overrides.upsertResult ?? { error: null })),
		select: vi.fn(() => ({
			eq: vi.fn((column: string, _value: unknown) => {
				// branch: searchPublic uses .eq().gt().textSearch().order().limit()
				// while findById uses .eq().single()
				if (column === 'visibility') return searchChain;
				return {
					single: vi.fn(() => Promise.resolve(overrides.selectResult ?? { data: makeDbRow(), error: null })),
				};
			}),
		})),
		delete: vi.fn(() => ({
			eq: vi.fn(() => Promise.resolve(overrides.deleteResult ?? { error: null, count: 1 })),
		})),
		insert: vi.fn(() => Promise.resolve(overrides.insertResult ?? { error: null })),
	}));

	const rpc = vi.fn(() => Promise.resolve(overrides.rpcResult ?? { data: [], error: null }));

	return { from, rpc, _searchChain: searchChain };
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
		__resetSupabaseClientCache();
		mockClient = makeSupabaseMock();
		__resetSupabaseClientCache();
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
			__resetSupabaseClientCache();
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

		it('sends user_id when set on the paste', async () => {
			const paste = new Paste(
				PasteId.create('with-user'),
				'content',
				new Date('2024-01-01T12:00:00Z'),
				ExpirationPolicy.create(3600),
				'Test',
				undefined,
				'public',
				false,
				0,
				false,
				undefined,
				0,
				'tok',
				'user-uuid-123',
			);
			await repository.save(paste);

			const upsertArg = (mockClient.from.mock.results[0].value.upsert.mock.calls as unknown[][])[0][0];
			expect(upsertArg).toMatchObject({ user_id: 'user-uuid-123' });
		});

		it('sends user_id = null for anonymous paste', async () => {
			const paste = makePaste(); // no userId
			await repository.save(paste);

			const upsertArg = (mockClient.from.mock.results[0].value.upsert.mock.calls as unknown[][])[0][0];
			expect(upsertArg).toMatchObject({ user_id: null });
		});
	});

	describe('findById', () => {
		it('returns a Paste when found', async () => {
			mockClient = makeSupabaseMock({ selectResult: { data: makeDbRow(), error: null } });
			__resetSupabaseClientCache();
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
			__resetSupabaseClientCache();
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
			__resetSupabaseClientCache();
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
			__resetSupabaseClientCache();
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

		it('maps user_id from snake_case to Paste.userId', async () => {
			const row = makeDbRow({ user_id: 'auth-user-xyz' });
			mockClient = makeSupabaseMock({ selectResult: { data: row, error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.findById(PasteId.create('test-uuid-1234'));
			expect(result?.getUserId()).toBe('auth-user-xyz');
		});

		it('maps null user_id to undefined (anonymous paste)', async () => {
			const row = makeDbRow({ user_id: null });
			mockClient = makeSupabaseMock({ selectResult: { data: row, error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.findById(PasteId.create('test-uuid-1234'));
			expect(result?.getUserId()).toBeUndefined();
		});
	});

	describe('delete', () => {
		it('returns true when a row is deleted', async () => {
			mockClient = makeSupabaseMock({ deleteResult: { error: null, count: 1 } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.delete(PasteId.create('test-uuid-1234'));
			expect(result).toBe(true);
		});

		it('returns false when no row was deleted (paste not found)', async () => {
			mockClient = makeSupabaseMock({ deleteResult: { error: null, count: 0 } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.delete(PasteId.create('nonexistent'));
			expect(result).toBe(false);
		});

		it('returns false and logs on error', async () => {
			mockClient = makeSupabaseMock({ deleteResult: { error: { message: 'DB error' }, count: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.delete(PasteId.create('test-uuid-1234'));
			expect(result).toBe(false);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});

	describe('deleteWithToken (atomic RPC delete) [M20]', () => {
		it('returns {found:true, deleted:true} when RPC reports a successful delete', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: [{ was_found: true, was_deleted: true }], error: null },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.deleteWithToken(PasteId.create('test-uuid'), 'token-uuid');
			expect(result).toEqual({ found: true, deleted: true });
			expect(mockClient.rpc).toHaveBeenCalledWith('delete_paste', {
				paste_uuid: 'test-uuid',
				owner_token: 'token-uuid',
			});
		});

		it('returns {found:false} when RPC reports paste not found', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: [{ was_found: false, was_deleted: false }], error: null },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.deleteWithToken(PasteId.create('nope'), 'tok');
			expect(result).toEqual({ found: false, deleted: false });
		});

		it('returns {found:true, deleted:false} when token mismatched', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: [{ was_found: true, was_deleted: false }], error: null },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.deleteWithToken(PasteId.create('id'), 'wrong-tok');
			expect(result).toEqual({ found: true, deleted: false });
		});

		it('returns {found:false} on invalid-UUID token (Postgres 22P02)', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.deleteWithToken(PasteId.create('id'), 'not-a-uuid');
			expect(result).toEqual({ found: false, deleted: false });
			// 22P02 is expected — no error log spam.
			expect(mockLogger.error).not.toHaveBeenCalled();
		});

		it('returns {found:false} and logs on other RPC errors', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: null, error: { message: 'connection lost' } },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.deleteWithToken(PasteId.create('id'), 'tok');
			expect(result).toEqual({ found: false, deleted: false });
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it('returns {found:false} when RPC returns an empty array', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: [], error: null },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.deleteWithToken(PasteId.create('id'), 'tok');
			expect(result).toEqual({ found: false, deleted: false });
		});
	});

	describe('claimSlug (atomic RPC slug claim) [M2/M3]', () => {
		const EXP = new Date('2030-01-01T00:00:00.000Z');

		it('calls claim_slug with snake_case args and returns true when claimed', async () => {
			mockClient = makeSupabaseMock({ rpcResult: { data: [{ claimed: true }], error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.claimSlug('my-slug', 'paste-uuid', EXP);
			expect(result).toBe(true);
			expect(mockClient.rpc).toHaveBeenCalledWith('claim_slug', {
				slug_text: 'my-slug',
				paste_uuid: 'paste-uuid',
				slug_expires_at: EXP.toISOString(),
			});
		});

		it('returns false when a LIVE row already holds the slug (claimed=false)', async () => {
			mockClient = makeSupabaseMock({ rpcResult: { data: [{ claimed: false }], error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			expect(await repository.claimSlug('taken', 'p', EXP)).toBe(false);
		});

		it('returns false (not undefined) when the RPC returns an empty result set', async () => {
			mockClient = makeSupabaseMock({ rpcResult: { data: [], error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			expect(await repository.claimSlug('s', 'p', EXP)).toBe(false);
		});

		it('throws and logs on RPC error', async () => {
			mockClient = makeSupabaseMock({ rpcResult: { data: null, error: { message: 'connection lost' } } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			await expect(repository.claimSlug('s', 'p', EXP)).rejects.toThrow(/Failed to claim slug/);
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});

	describe('view (RPC-based atomic view)', () => {
		it('calls the view_paste RPC with the correct paste_uuid', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: {
					data: [{ paste_data: makeDbRow(), was_burned: false, was_view_limited: false }],
					error: null,
				},
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			await repository.view(PasteId.create('test-uuid-1234'));

			expect(mockClient.rpc).toHaveBeenCalledWith('view_paste', { paste_uuid: 'test-uuid-1234' });
		});

		it('returns the paste with wasBurned=false on normal view', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: {
					data: [
						{
							paste_data: makeDbRow({ read_count: 1 }),
							was_burned: false,
							was_view_limited: false,
						},
					],
					error: null,
				},
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.view(PasteId.create('test-uuid-1234'));

			expect(result.paste).not.toBeNull();
			expect(result.paste!.getReadCount()).toBe(1);
			expect(result.wasBurned).toBe(false);
			expect(result.wasViewLimited).toBe(false);
		});

		it('returns paste with wasBurned=true on burn-after-reading', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: {
					data: [
						{
							paste_data: makeDbRow({ burn_after_reading: true, read_count: 1 }),
							was_burned: true,
							was_view_limited: false,
						},
					],
					error: null,
				},
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.view(PasteId.create('test-uuid-1234'));

			expect(result.paste).not.toBeNull();
			expect(result.wasBurned).toBe(true);
		});

		it('returns paste with wasViewLimited=true when view limit hit', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: {
					data: [
						{
							paste_data: makeDbRow({ read_count: 5, view_limit: 5 }),
							was_burned: false,
							was_view_limited: true,
						},
					],
					error: null,
				},
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.view(PasteId.create('test-uuid-1234'));

			expect(result.paste).not.toBeNull();
			expect(result.wasViewLimited).toBe(true);
		});

		it('returns null paste when RPC returns 0 rows (not found / expired / cleaned)', async () => {
			mockClient = makeSupabaseMock({ rpcResult: { data: [], error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.view(PasteId.create('nonexistent'));

			expect(result).toEqual({ paste: null, wasBurned: false, wasViewLimited: false });
		});

		it('returns null paste and logs on RPC error', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: null, error: { message: 'function not found' } },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.view(PasteId.create('test-uuid-1234'));

			expect(result).toEqual({ paste: null, wasBurned: false, wasViewLimited: false });
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});

	describe('searchPublic (FTS)', () => {
		it('returns [] for empty query without hitting the DB', async () => {
			const result = await repository.searchPublic('   ', 20);
			expect(result).toEqual([]);
			expect(mockClient.from).not.toHaveBeenCalled();
		});

		it('builds a textSearch query with websearch type and english config', async () => {
			mockClient = makeSupabaseMock({ searchResult: { data: [makeDbRow()], error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			await repository.searchPublic('hello world', 10);

			expect(mockClient._searchChain.textSearch).toHaveBeenCalledWith(
				'search_vector',
				'hello world',
				{ type: 'websearch', config: 'english' },
			);
			expect(mockClient._searchChain.limit).toHaveBeenCalledWith(10);
		});

		it('maps result rows to Paste objects', async () => {
			mockClient = makeSupabaseMock({
				searchResult: {
					data: [makeDbRow({ id: 'p1' }), makeDbRow({ id: 'p2' })],
					error: null,
				},
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const results = await repository.searchPublic('foo', 10);

			expect(results).toHaveLength(2);
			expect(results[0].getId().toString()).toBe('p1');
			expect(results[1].getId().toString()).toBe('p2');
		});

		it('returns [] and logs on error', async () => {
			mockClient = makeSupabaseMock({
				searchResult: { data: null, error: { message: 'syntax error' } },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const results = await repository.searchPublic('foo', 10);

			expect(results).toEqual([]);
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it('trims whitespace before searching', async () => {
			mockClient = makeSupabaseMock({ searchResult: { data: [], error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			await repository.searchPublic('   foo   ', 10);

			expect(mockClient._searchChain.textSearch).toHaveBeenCalledWith(
				'search_vector',
				'foo',
				expect.any(Object),
			);
		});
	});

	describe('getPublicStats (paste_stats RPC)', () => {
		it('calls the paste_stats RPC and returns the parsed payload', async () => {
			const fakeStats = {
				totalPublic: 42,
				byLanguage: [{ language: 'typescript', count: 10 }],
				byHour: [{ hour: '2026-05-11T15:00:00+00:00', count: 5 }],
				encryption: { '0': 30, '2': 12 },
				generatedAt: '2026-05-11T15:30:00.000Z',
			};
			mockClient = makeSupabaseMock({ rpcResult: { data: fakeStats, error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.getPublicStats();

			expect(mockClient.rpc).toHaveBeenCalledWith('paste_stats');
			expect(result).toEqual(fakeStats);
		});

		it('returns null and logs on RPC error', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: null, error: { message: 'function not found' } },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.getPublicStats();

			expect(result).toBeNull();
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it('returns null when RPC returns a non-object', async () => {
			mockClient = makeSupabaseMock({ rpcResult: { data: null, error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.getPublicStats();

			expect(result).toBeNull();
		});
	});

	describe('updateWithToken (atomic RPC update)', () => {
		// Mirrors deleteWithToken tests; semantics differ only in {found,updated}
		// shape and the extra new_content / new_title / new_language args.

		it('returns {found:true, updated:true} when RPC reports success', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: [{ was_found: true, was_updated: true }], error: null },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.updateWithToken(
				PasteId.create('test-uuid'),
				'token-uuid',
				{ content: 'new', title: 'T', language: 'rust' },
			);
			expect(result).toEqual({ found: true, updated: true });
			expect(mockClient.rpc).toHaveBeenCalledWith('update_paste', {
				paste_uuid: 'test-uuid',
				owner_token: 'token-uuid',
				new_content: 'new',
				new_title: 'T',
				new_language: 'rust',
			});
		});

		it('passes null for omitted fields (partial update)', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: [{ was_found: true, was_updated: true }], error: null },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			await repository.updateWithToken(PasteId.create('id'), 'tok', { content: 'only-content' });

			expect(mockClient.rpc).toHaveBeenCalledWith('update_paste', {
				paste_uuid: 'id',
				owner_token: 'tok',
				new_content: 'only-content',
				new_title: null,
				new_language: null,
			});
		});

		it('returns {found:false} when RPC reports paste not found', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: [{ was_found: false, was_updated: false }], error: null },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.updateWithToken(PasteId.create('nope'), 'tok', { content: 'x' });
			expect(result).toEqual({ found: false, updated: false });
		});

		it('returns {found:true, updated:false} when token mismatched', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: [{ was_found: true, was_updated: false }], error: null },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.updateWithToken(PasteId.create('id'), 'wrong', { content: 'x' });
			expect(result).toEqual({ found: true, updated: false });
		});

		it('returns {found:false} on invalid-UUID token (Postgres 22P02)', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.updateWithToken(PasteId.create('id'), 'not-a-uuid', { content: 'x' });
			expect(result).toEqual({ found: false, updated: false });
			expect(mockLogger.error).not.toHaveBeenCalled();
		});

		it('returns {found:false} and logs on other RPC errors', async () => {
			mockClient = makeSupabaseMock({
				rpcResult: { data: null, error: { message: 'connection lost' } },
			});
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.updateWithToken(PasteId.create('id'), 'tok', { content: 'x' });
			expect(result).toEqual({ found: false, updated: false });
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});

	describe('mapRow Zod validation', () => {
		// The boundary check catches Supabase schema drift early.
		// A row with the wrong shape used to silently produce a half-
		// constructed Paste that exploded deep in the domain layer (e.g.
		// `ExpirationPolicy.create(NaN)` when `created_at` was missing).

		it('rejects a row missing required fields with RepositoryShapeError', async () => {
			const brokenRow = {
				id: 'test-uuid',
				// content missing
				created_at: '2024-01-01T00:00:00Z',
				expires_at: '2024-01-01T01:00:00Z',
				visibility: 'public',
				burn_after_reading: false,
				read_count: 0,
				is_encrypted: false,
				version: 0,
			};
			mockClient = makeSupabaseMock({ selectResult: { data: brokenRow, error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			// findById catches the throw and returns null, but the error is logged
			// so this verifies the validation actually fires.
			await expect(
				repository.findById(PasteId.create('test-uuid')),
			).rejects.toThrow(/Paste row does not match expected shape/);
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('shape mismatch'),
				expect.objectContaining({ issues: expect.any(Array) }),
			);
		});

		it('rejects a row with wrong type for a field', async () => {
			const brokenRow = makeDbRow({ read_count: 'five' as unknown as number });
			mockClient = makeSupabaseMock({ selectResult: { data: brokenRow, error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			await expect(repository.findById(PasteId.create('test-uuid'))).rejects.toThrow(/shape/i);
		});

		it('accepts a row with extra unknown columns (passthrough)', async () => {
			const rowWithExtras = makeDbRow({ extra_future_column: 'should-not-fail' });
			mockClient = makeSupabaseMock({ selectResult: { data: rowWithExtras, error: null } });
			__resetSupabaseClientCache();
			vi.mocked(createClient).mockReturnValue(mockClient as any);
			repository = new SupabasePasteRepository('https://test.supabase.co', 'sb_secret_test', mockLogger);

			const result = await repository.findById(PasteId.create('test-uuid-1234'));
			expect(result).not.toBeNull();
		});
	});
});
