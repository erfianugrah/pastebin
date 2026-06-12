import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreatePasteCommand, CreatePasteParams, CreatePasteSchema } from '../../../application/commands/createPasteCommand';
import { PasteRepository } from '../../../domain/repositories/pasteRepository';
import { UniqueIdService } from '../../../domain/services/uniqueIdService';
import { ExpirationService } from '../../../domain/services/expirationService';
import { Paste, PasteId, ExpirationPolicy } from '../../../domain/models/paste';
import { AppError } from '../../../infrastructure/errors/AppError';

// Mock dependencies
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

const mockIdService: UniqueIdService = {
  generateId: vi.fn(),
};

const mockExpirationService: ExpirationService = {
  createFromSeconds: vi.fn(),
  createDefault: vi.fn(),
  createNever: vi.fn(),
};

describe('CreatePasteCommand', () => {
  let command: CreatePasteCommand;
  const baseUrl = 'https://pastebin.example.com';
  
  beforeEach(() => {
    vi.resetAllMocks();
    command = new CreatePasteCommand(
      mockRepository,
      mockIdService,
      mockExpirationService,
      baseUrl,
    );
  });
  
  it('should create a paste successfully', async () => {
    // Mock data
    const pasteId = PasteId.create('abc123');
    const expirationPolicy = ExpirationPolicy.create(86400);
    
    const params: CreatePasteParams = {
      content: 'Test content',
      title: 'Test Title',
      language: 'javascript',
      expiration: 86400,
      visibility: 'public',
      burnAfterReading: false,
      isEncrypted: false,
      version: 2, // Use client-side encryption by default
    };
    
    // Setup mocks
    vi.mocked(mockIdService.generateId).mockResolvedValue(pasteId);
    vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(expirationPolicy);
    
    // Execute command
    const result = await command.execute(params);
    
    // Assertions
    expect(mockIdService.generateId).toHaveBeenCalledTimes(1);
    expect(mockExpirationService.createFromSeconds).toHaveBeenCalledWith(86400);
    expect(mockRepository.save).toHaveBeenCalledTimes(1);
    
    // Verify the paste created
    const savedPaste = vi.mocked(mockRepository.save).mock.calls[0][0];
    expect(savedPaste).toBeInstanceOf(Paste);
    expect(savedPaste.getId()).toBe(pasteId);
    expect(savedPaste.getContent()).toBe('Test content');
    expect(savedPaste.getTitle()).toBe('Test Title');
    expect(savedPaste.getLanguage()).toBe('javascript');
    expect(savedPaste.getVisibility()).toBe('public');
    
    // Verify command result
    expect(result).toMatchObject({
      id: 'abc123',
      url: 'https://pastebin.example.com/pastes/abc123',
      expiresAt: savedPaste.getExpiresAt().toISOString(),
    });
    // deleteToken should be a UUID string
    expect(result.deleteToken).toBeDefined();
    expect(typeof result.deleteToken).toBe('string');
  });
  
  it('should create a paste with minimal parameters', async () => {
    // Mock data
    const pasteId = PasteId.create('abc123');
    const expirationPolicy = ExpirationPolicy.create(86400);
    
    const params: CreatePasteParams = {
      content: 'Test content',
      expiration: 86400,
      visibility: 'public',
      burnAfterReading: false,
      isEncrypted: false,
      version: 2, // Use client-side encryption by default
    };
    
    // Setup mocks
    vi.mocked(mockIdService.generateId).mockResolvedValue(pasteId);
    vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(expirationPolicy);
    
    // Execute command
    const result = await command.execute(params);
    
    // Assertions
    expect(mockIdService.generateId).toHaveBeenCalledTimes(1);
    expect(mockExpirationService.createFromSeconds).toHaveBeenCalledWith(86400);
    expect(mockRepository.save).toHaveBeenCalledTimes(1);
    
    // Verify the paste created
    const savedPaste = vi.mocked(mockRepository.save).mock.calls[0][0];
    expect(savedPaste).toBeInstanceOf(Paste);
    expect(savedPaste.getId()).toBe(pasteId);
    expect(savedPaste.getContent()).toBe('Test content');
    expect(savedPaste.getTitle()).toBeUndefined();
    expect(savedPaste.getLanguage()).toBeUndefined();
    expect(savedPaste.getVisibility()).toBe('public');
    
    // Verify command result
    expect(result).toMatchObject({
      id: 'abc123',
      url: 'https://pastebin.example.com/pastes/abc123',
      expiresAt: savedPaste.getExpiresAt().toISOString(),
    });
    expect(result.deleteToken).toBeDefined();
    expect(typeof result.deleteToken).toBe('string');
  });
  
  it('should throw an error if content is empty', async () => {
    const params: any = {
      content: '',
    };
    
    await expect(command.execute(params)).rejects.toThrow();
  });

  it('passes opts.userId into the created paste', async () => {
    vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('with-user'));
    vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(ExpirationPolicy.create(86400));

    const params: CreatePasteParams = {
      content: 'authed content',
      expiration: 86400,
      visibility: 'public',
      burnAfterReading: false,
      isEncrypted: false,
      version: 0,
    };

    await command.execute(params, { userId: 'user-uuid-123' });

    const savedPaste = vi.mocked(mockRepository.save).mock.calls[0][0];
    expect(savedPaste.getUserId()).toBe('user-uuid-123');
  });

  it('omits user_id (undefined) for anonymous calls', async () => {
    vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('anon'));
    vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(ExpirationPolicy.create(86400));

    const params: CreatePasteParams = {
      content: 'anon content',
      expiration: 86400,
      visibility: 'public',
      burnAfterReading: false,
      isEncrypted: false,
      version: 0,
    };

    await command.execute(params);

    const savedPaste = vi.mocked(mockRepository.save).mock.calls[0][0];
    expect(savedPaste.getUserId()).toBeUndefined();
  });

  it('rejects a language field longer than 50 chars [H4]', async () => {
    const params: any = {
      content: 'x',
      language: 'a'.repeat(51),
    };
    await expect(command.execute(params)).rejects.toThrow();
  });

  it('rejects `password` field server-side (client never sends it post-fix) [M5]', async () => {
    // The Zod schema no longer accepts `password`. With Zod's default
    // strip-unknown behaviour, the field is silently dropped — but it must
    // never reach the encryption flag path.
    vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('m5'));
    vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(ExpirationPolicy.create(86400));

    const params: any = {
      content: 'plain text',
      password: 'should-be-ignored',
      isEncrypted: false,
    };
    await command.execute(params);
    const savedPaste = vi.mocked(mockRepository.save).mock.calls[0][0];
    expect(savedPaste.getIsEncrypted()).toBe(false);
    expect(savedPaste.getVersion()).toBe(0);
  });

  describe('content byte cap [Low/consistency]', () => {
    const baseParams = {
      expiration: 86400,
      visibility: 'public' as const,
      burnAfterReading: false,
      isEncrypted: false,
      version: 0,
    };

    it('accepts a normal multibyte payload well under the byte cap', () => {
      const result = CreatePasteSchema.safeParse({ ...baseParams, content: '\u4e2d\u6587 \ud83d\ude00 hello' });
      expect(result.success).toBe(true);
    });

    it('rejects multibyte content over the byte cap but under the code-unit count', () => {
      const MAX = 25 * 1024 * 1024;
      // 3-byte CJK char: 1 UTF-16 code unit, 3 UTF-8 bytes. This string is
      // UNDER the code-unit .max() but OVER the 25 MiB UTF-8 byte cap, so the
      // old char-counting .max() accepted it — the refine must reject it.
      const overByBytes = '\u4e2d'.repeat(Math.floor(MAX / 3) + 1);
      expect(overByBytes.length).toBeLessThanOrEqual(MAX);
      expect(new TextEncoder().encode(overByBytes).length).toBeGreaterThan(MAX);
      const result = CreatePasteSchema.safeParse({ ...baseParams, content: overByBytes });
      expect(result.success).toBe(false);
    });
  });

  describe('expiration bounds [M1]', () => {
    const baseParams = {
      content: 'content',
      visibility: 'public' as const,
      burnAfterReading: false,
      isEncrypted: false,
      version: 0,
    };

    it('rejects an out-of-range expiration before it can 500 the create path', async () => {
      // 1e300 passes the old `.positive()` but overflows the JS Date range
      // (Date.setSeconds(now + 1e300) → Invalid Date → toISOString() throws
      // RangeError → unhandled 500). The `.int().max()` bound rejects it at
      // the schema boundary instead.
      vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('m1'));
      await expect(command.execute({ ...baseParams, expiration: 1e300 })).rejects.toBeDefined();
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a non-integer expiration', async () => {
      await expect(command.execute({ ...baseParams, expiration: 1.5 })).rejects.toBeDefined();
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('accepts the 10-year cap exactly', async () => {
      vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('m1cap'));
      vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(ExpirationPolicy.create(315360000));
      vi.mocked(mockRepository.save).mockResolvedValue(undefined);
      await expect(command.execute({ ...baseParams, expiration: 315360000 })).resolves.toBeDefined();
    });
  });

  it('compensating-deletes the orphan + 409s when claimSlug loses the race [M2/M6]', async () => {
    vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('m6'));
    vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(ExpirationPolicy.create(86400));
    vi.mocked(mockRepository.resolveSlug).mockResolvedValue(null); // precheck passes
    vi.mocked(mockRepository.save).mockResolvedValue(undefined);
    vi.mocked(mockRepository.claimSlug).mockResolvedValue(false); // live conflict / race-loser
    vi.mocked(mockRepository.delete).mockResolvedValue(true);

    const params: CreatePasteParams = {
      content: 'racing content',
      expiration: 86400,
      visibility: 'public',
      burnAfterReading: false,
      isEncrypted: false,
      version: 0,
      slug: 'race-loser',
    };

    await expect(command.execute(params)).rejects.toMatchObject({
      code: 'slug_taken',
      statusCode: 409,
    });
    // the just-saved paste must be compensating-deleted so it isn't orphaned
    const saved = vi.mocked(mockRepository.save).mock.calls[0][0];
    expect(mockRepository.delete).toHaveBeenCalledWith(saved.getId());
  });

  it('translates resolveSlug precheck hit into AppError(409) [M6]', async () => {
    vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('m6b'));
    vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(ExpirationPolicy.create(86400));
    vi.mocked(mockRepository.resolveSlug).mockResolvedValue('existing-paste-id');

    const params: CreatePasteParams = {
      content: 'content',
      expiration: 86400,
      visibility: 'public',
      burnAfterReading: false,
      isEncrypted: false,
      version: 0,
      slug: 'taken',
    };

    await expect(command.execute(params)).rejects.toBeInstanceOf(AppError);
    // precheck rejects BEFORE save — no orphan paste, no claim attempt
    expect(mockRepository.save).not.toHaveBeenCalled();
    expect(mockRepository.claimSlug).not.toHaveBeenCalled();
  });

  describe('slug validation [M7]', () => {
    const baseParams = {
      content: 'content',
      expiration: 86400,
      visibility: 'public' as const,
      burnAfterReading: false,
      isEncrypted: false,
      version: 0,
    };

    it('rejects slugs with consecutive hyphens', async () => {
      vi.mocked(mockRepository.resolveSlug).mockResolvedValue(null);
      await expect(command.execute({ ...baseParams, slug: 'foo--bar' })).rejects.toBeDefined();
    });

    it('rejects slugs starting with a hyphen', async () => {
      vi.mocked(mockRepository.resolveSlug).mockResolvedValue(null);
      await expect(command.execute({ ...baseParams, slug: '-foo' })).rejects.toBeDefined();
    });

    it('rejects slugs ending with a hyphen', async () => {
      vi.mocked(mockRepository.resolveSlug).mockResolvedValue(null);
      await expect(command.execute({ ...baseParams, slug: 'foo-' })).rejects.toBeDefined();
    });

    it('accepts slugs with single internal hyphens', async () => {
      vi.mocked(mockRepository.resolveSlug).mockResolvedValue(null);
      vi.mocked(mockRepository.claimSlug).mockResolvedValue(true);
      vi.mocked(mockRepository.save).mockResolvedValue(undefined);
      vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('id'));
      await expect(command.execute({ ...baseParams, slug: 'my-cool-snippet' })).resolves.toBeDefined();
    });
  });

  it('claims a slug whose stale row was reaped, returning the vanity URL [M3]', async () => {
    // resolveSlug returns null (no LIVE row) but a dead row may still exist;
    // claimSlug upserts over it and reports true — no spurious 409.
    vi.mocked(mockIdService.generateId).mockResolvedValue(PasteId.create('m3'));
    vi.mocked(mockExpirationService.createFromSeconds).mockReturnValue(ExpirationPolicy.create(86400));
    vi.mocked(mockRepository.resolveSlug).mockResolvedValue(null);
    vi.mocked(mockRepository.save).mockResolvedValue(undefined);
    vi.mocked(mockRepository.claimSlug).mockResolvedValue(true);

    const result = await command.execute({
      content: 'content',
      expiration: 86400,
      visibility: 'public',
      burnAfterReading: false,
      isEncrypted: false,
      version: 0,
      slug: 'recycled',
    });

    expect(result.url).toBe('https://pastebin.example.com/p/recycled');
    expect(mockRepository.delete).not.toHaveBeenCalled();
  });
});