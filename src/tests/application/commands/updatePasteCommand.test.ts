import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdatePasteCommand, UpdateErrorCode, UpdatePasteSchema } from '../../../application/commands/updatePasteCommand';
import { PasteRepository } from '../../../domain/repositories/pasteRepository';

const mockRepo = {
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
} as unknown as PasteRepository;

// RFC 4122 v4 UUID — Zod 4's `.uuid()` enforces the version+variant nibbles.
// Format: xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
//   M = version (1-8) — here `4` for v4
//   N = variant (8/9/a/b) — here `8` for RFC 4122 variant
const VALID_TOKEN = '12345678-1234-4123-8123-123456789012';

describe('UpdatePasteCommand', () => {
	let command: UpdatePasteCommand;

	beforeEach(() => {
		vi.resetAllMocks();
		command = new UpdatePasteCommand(mockRepo);
	});

	describe('UpdatePasteSchema', () => {
		// The schema is the single source of truth for what PUT /pastes/:id
		// accepts. The old handler used a TS cast instead of runtime
		// validation, so non-string content, oversized payloads, and
		// non-UUID tokens all fell through to the DB layer.

		it('accepts a minimal valid payload', () => {
			const result = UpdatePasteSchema.safeParse({
				token: VALID_TOKEN,
				content: 'new content',
			});
			expect(result.success).toBe(true);
		});

		it('accepts partial payload (token + title only)', () => {
			const result = UpdatePasteSchema.safeParse({
				token: VALID_TOKEN,
				title: 'just a new title',
			});
			expect(result.success).toBe(true);
		});

		it('rejects missing token', () => {
			const result = UpdatePasteSchema.safeParse({ content: 'orphan' });
			expect(result.success).toBe(false);
		});

		it('rejects non-UUID token (string)', () => {
			const result = UpdatePasteSchema.safeParse({
				token: 'not-a-uuid',
				content: 'x',
			});
			expect(result.success).toBe(false);
		});

		it('rejects non-string content', () => {
			const result = UpdatePasteSchema.safeParse({
				token: VALID_TOKEN,
				content: 0,
			});
			expect(result.success).toBe(false);
		});

		it('rejects empty-string content (min:1 prevents wiping the paste accidentally)', () => {
			const result = UpdatePasteSchema.safeParse({
				token: VALID_TOKEN,
				content: '',
			});
			expect(result.success).toBe(false);
		});

		// 25 MiB cap mirrors the create-path schema. Without it, a
		// token-holder could DoS the Worker isolate with a single huge
		// payload (Worker memory budget ~128 MiB).
		it('rejects content larger than the 25 MiB cap', () => {
			const oversized = 'a'.repeat(25 * 1024 * 1024 + 1);
			const result = UpdatePasteSchema.safeParse({
				token: VALID_TOKEN,
				content: oversized,
			});
			expect(result.success).toBe(false);
		});

		// Byte-vs-code-unit: a 3-byte CJK char is 1 UTF-16 code unit, so this
		// string is UNDER the code-unit `.max()` but OVER the 25 MiB UTF-8
		// byte cap — the old char-counting `.max()` accepted it; the refine
		// must reject it.
		it('rejects multibyte content over the byte cap but under the code-unit count', () => {
			const MAX = 25 * 1024 * 1024;
			const overByBytes = '\u4e2d'.repeat(Math.floor(MAX / 3) + 1); // 3 bytes each
			expect(overByBytes.length).toBeLessThanOrEqual(MAX); // passes .max()
			expect(new TextEncoder().encode(overByBytes).length).toBeGreaterThan(MAX); // fails refine
			const result = UpdatePasteSchema.safeParse({ token: VALID_TOKEN, content: overByBytes });
			expect(result.success).toBe(false);
		});

		it('rejects title longer than 100 chars', () => {
			const result = UpdatePasteSchema.safeParse({
				token: VALID_TOKEN,
				title: 'x'.repeat(101),
			});
			expect(result.success).toBe(false);
		});

		it('rejects language longer than 50 chars', () => {
			const result = UpdatePasteSchema.safeParse({
				token: VALID_TOKEN,
				language: 'l'.repeat(51),
			});
			expect(result.success).toBe(false);
		});

		// Fields NOT in the schema are explicit on purpose — see the
		// schema doc comment. Verify Zod strips them rather than silently
		// passing them through.
		it.each([
			['visibility', 'public'],
			['burnAfterReading', true],
			['viewLimit', 5],
			['readCount', 0],
			['version', 2],
			['isEncrypted', true],
			['expiration', 3600],
			['deleteToken', 'rotate-me'],
			['userId', 'user-uuid'],
		])('drops unknown / forbidden field %s', (field, value) => {
			const result = UpdatePasteSchema.safeParse({
				token: VALID_TOKEN,
				content: 'ok',
				[field]: value,
			});
			expect(result.success).toBe(true);
			expect((result as any).data?.[field]).toBeUndefined();
		});
	});

	describe('execute', () => {
		it('returns success when repository.updateWithToken reports updated:true', async () => {
			vi.mocked(mockRepo.updateWithToken).mockResolvedValue({ found: true, updated: true });

			const result = await command.execute('paste-id', {
				token: VALID_TOKEN,
				content: 'updated',
			});

			expect(result.success).toBe(true);
			expect(result.errorCode).toBeUndefined();
			expect(mockRepo.updateWithToken).toHaveBeenCalledWith(
				expect.objectContaining({ toString: expect.any(Function) }),
				VALID_TOKEN,
				{ content: 'updated', title: undefined, language: undefined },
			);
		});

		it('returns NOT_FOUND when repository reports found:false', async () => {
			vi.mocked(mockRepo.updateWithToken).mockResolvedValue({ found: false, updated: false });

			const result = await command.execute('missing', {
				token: VALID_TOKEN,
				content: 'x',
			});

			expect(result.success).toBe(false);
			expect(result.errorCode).toBe(UpdateErrorCode.NOT_FOUND);
		});

		it('returns UNAUTHORIZED when repository reports found:true, updated:false', async () => {
			vi.mocked(mockRepo.updateWithToken).mockResolvedValue({ found: true, updated: false });

			const result = await command.execute('id', {
				token: VALID_TOKEN,
				content: 'x',
			});

			expect(result.success).toBe(false);
			expect(result.errorCode).toBe(UpdateErrorCode.UNAUTHORIZED);
		});

		// The command re-parses the schema (defensive — callers go through
		// the handler which already validated, but the command shouldn't
		// trust that). Invalid params throw ZodError, which the handler's
		// `rethrowIfZodError` converts to AppError(400).
		it('throws Zod error on invalid params', async () => {
			await expect(
				command.execute('id', { content: 'no token' } as any),
			).rejects.toMatchObject({
				issues: expect.any(Array),
			});
			expect(mockRepo.updateWithToken).not.toHaveBeenCalled();
		});
	});
});
