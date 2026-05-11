import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KVPasteRepository } from '../../../infrastructure/storage/kvPasteRepository';
import { Paste, PasteId } from '../../../domain/models/paste';
import { Logger } from '../../../infrastructure/logging/logger';
import { ExpirationPolicy } from '../../../domain/models/paste';

// Mock dependencies
const mockKV = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
};

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

describe('KVPasteRepository', () => {
  let repository: KVPasteRepository;
  
  beforeEach(() => {
    vi.resetAllMocks();
    repository = new KVPasteRepository(mockKV as any, mockLogger);
  });
  
  describe('save', () => {
    it('should save a paste to KV with expiration', async () => {
      // Create a paste with a fixed timestamp for testing
      const id = PasteId.create('abc123');
      const createdAt = new Date('2023-01-01T12:00:00Z');
      const expirationPolicy = ExpirationPolicy.create(3600);
      
      const paste = new Paste(
        id,
        'content',
        createdAt,
        expirationPolicy,
        'title',
        'javascript',
        'public',
      );
      
      // Mock Date.now() to return a fixed timestamp
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2023-01-01T12:00:00Z').getTime());
      
      await repository.save(paste);
      
      // Verify KV put was called with the correct arguments
      expect(mockKV.put).toHaveBeenCalledTimes(2); // Once for the paste, once for the recent list
      
      // Verify the first put call (the paste itself)
      const [putKey, putValue, putOptions] = mockKV.put.mock.calls[0];
      expect(putKey).toBe('abc123');
      expect(JSON.parse(putValue)).toEqual({
        id: 'abc123',
        content: 'content',
        title: 'title',
        language: 'javascript',
        createdAt: '2023-01-01T12:00:00.000Z',
        expiresAt: '2023-01-01T13:00:00.000Z',
        visibility: 'public',
        burnAfterReading: false,
        isEncrypted: false,
        securityType: 'Public',
        readCount: 0,
        version: 0,
        hasViewLimit: false,
        remainingViews: null,
        viewLimit: undefined,
      });
      expect(putOptions).toEqual({
        expirationTtl: 3600,
      });
      
      // Restore Date.now
      nowSpy.mockRestore();
    });
    
    it('should add public pastes to the recent list', async () => {
      // Create a paste with a fixed timestamp for testing
      const id = PasteId.create('abc123');
      const createdAt = new Date('2023-01-01T12:00:00Z');
      const expirationPolicy = ExpirationPolicy.create(3600);
      
      const paste = new Paste(
        id,
        'content',
        createdAt,
        expirationPolicy,
        'title',
        'javascript',
        'public',
      );
      
      // Mock Date.now() to return a fixed timestamp
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2023-01-01T12:00:00Z').getTime());
      
      await repository.save(paste);
      
      // Verify the second put call (the recent list entry)
      const [recentKey, recentValue, recentOptions] = mockKV.put.mock.calls[1];
      expect(recentKey).toBe('recent:1672574400000:abc123');
      expect(recentValue).toBe('abc123');
      expect(recentOptions).toEqual({
        expirationTtl: 3600,
      });
      
      // Restore Date.now
      nowSpy.mockRestore();
    });
    
    it('should not add private pastes to the recent list', async () => {
      // Create a paste with a fixed timestamp for testing
      const id = PasteId.create('abc123');
      const createdAt = new Date('2023-01-01T12:00:00Z');
      const expirationPolicy = ExpirationPolicy.create(3600);
      
      const paste = new Paste(
        id,
        'content',
        createdAt,
        expirationPolicy,
        'title',
        'javascript',
        'private',
      );
      
      await repository.save(paste);
      
      // Verify KV put was called only once (for the paste itself)
      expect(mockKV.put).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('findById', () => {
    it('should return null if paste does not exist', async () => {
      // Setup mock to return null
      mockKV.get.mockResolvedValue(null);
      
      const result = await repository.findById(PasteId.create('nonexistent'));
      
      expect(result).toBeNull();
      expect(mockKV.get).toHaveBeenCalledWith('nonexistent');
    });
    
    it('should return a paste if it exists', async () => {
      // Setup mock to return a paste
      const pasteData = {
        id: 'abc123',
        content: 'content',
        title: 'title',
        language: 'javascript',
        createdAt: '2023-01-01T12:00:00.000Z',
        expiresAt: '2023-01-01T13:00:00.000Z',
        visibility: 'public',
      };
      
      mockKV.get.mockResolvedValue(JSON.stringify(pasteData));
      
      const result = await repository.findById(PasteId.create('abc123'));
      
      expect(result).not.toBeNull();
      expect(result?.getId().toString()).toBe('abc123');
      expect(result?.getContent()).toBe('content');
      expect(result?.getTitle()).toBe('title');
      expect(result?.getLanguage()).toBe('javascript');
      expect(result?.getVisibility()).toBe('public');
      expect(mockKV.get).toHaveBeenCalledWith('abc123');
    });
    
    it('should handle parsing errors gracefully', async () => {
      // Setup mock to return invalid JSON
      mockKV.get.mockResolvedValue('invalid json');
      
      const result = await repository.findById(PasteId.create('abc123'));
      
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
  
  describe('delete', () => {
    it('should return false if paste does not exist', async () => {
      // Setup mock to return null
      mockKV.get.mockResolvedValue(null);
      
      const result = await repository.delete(PasteId.create('nonexistent'));
      
      expect(result).toBe(false);
      expect(mockKV.delete).not.toHaveBeenCalled();
    });
    
    it('should delete the paste and return true if it exists', async () => {
      // Setup mock to return a paste
      mockKV.get.mockResolvedValue('{}');
      mockKV.list.mockResolvedValue({ keys: [], list_complete: true });
      
      const result = await repository.delete(PasteId.create('abc123'));
      
      expect(result).toBe(true);
      expect(mockKV.delete).toHaveBeenCalledWith('abc123');
    });
    
    it('should remove the paste from the recent list', async () => {
      // Setup mocks
      mockKV.get.mockResolvedValue('{}');
      mockKV.list.mockResolvedValue({
        keys: [
          { name: 'recent:1672574400000:abc123' },
          { name: 'recent:1672574500000:def456' },
        ],
        list_complete: true,
      });
      
      await repository.delete(PasteId.create('abc123'));
      
      // Verify KV delete was called for both the paste and the recent list entry
      expect(mockKV.delete).toHaveBeenCalledTimes(2);
      expect(mockKV.delete).toHaveBeenCalledWith('abc123');
      expect(mockKV.delete).toHaveBeenCalledWith('recent:1672574400000:abc123');
    });
  });

  describe('view (race-prone orchestration)', () => {
    // KV has no row lock primitive -- these tests verify the documented
    // best-effort behavior. Supabase tests cover the atomic version via
    // the view_paste() RPC.

    function storedPaste(id: string, overrides: Record<string, unknown> = {}) {
      return JSON.stringify({
        id,
        content: 'content',
        title: 'title',
        language: 'javascript',
        createdAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        visibility: 'public',
        burnAfterReading: false,
        readCount: 0,
        isEncrypted: false,
        viewLimit: undefined,
        version: 0,
        deleteToken: 'tok',
        ...overrides,
      });
    }

    it('returns null when paste not found', async () => {
      mockKV.get.mockResolvedValue(null);

      const result = await repository.view(PasteId.create('missing'));

      expect(result).toEqual({ paste: null, wasBurned: false, wasViewLimited: false });
      expect(mockKV.delete).not.toHaveBeenCalled();
    });

    it('increments read_count and returns paste on normal view', async () => {
      mockKV.get.mockResolvedValue(storedPaste('abc', { readCount: 2 }));
      mockKV.list.mockResolvedValue({ keys: [], list_complete: true });

      const result = await repository.view(PasteId.create('abc'));

      expect(result.paste).not.toBeNull();
      expect(result.paste!.getReadCount()).toBe(3);
      expect(result.wasBurned).toBe(false);
      expect(result.wasViewLimited).toBe(false);
      expect(mockKV.put).toHaveBeenCalledTimes(2); // save (paste + recent list)
      expect(mockKV.delete).not.toHaveBeenCalled();
    });

    it('deletes and returns null for expired paste', async () => {
      const expiredAt = new Date(Date.now() - 1000).toISOString();
      mockKV.get.mockResolvedValue(
        storedPaste('exp', {
          createdAt: new Date(Date.now() - 7200 * 1000).toISOString(),
          expiresAt: expiredAt,
        }),
      );
      mockKV.list.mockResolvedValue({ keys: [], list_complete: true });

      const result = await repository.view(PasteId.create('exp'));

      expect(result.paste).toBeNull();
      expect(mockKV.delete).toHaveBeenCalled();
    });

    it('serves content then deletes for burn_after_reading', async () => {
      mockKV.get.mockResolvedValue(storedPaste('burn', { burnAfterReading: true }));
      mockKV.list.mockResolvedValue({ keys: [], list_complete: true });

      const result = await repository.view(PasteId.create('burn'));

      expect(result.paste).not.toBeNull();
      expect(result.paste!.getContent()).toBe('content');
      expect(result.wasBurned).toBe(true);
      expect(mockKV.delete).toHaveBeenCalled();
    });

    it('deletes and returns null when view_limit already reached', async () => {
      mockKV.get.mockResolvedValue(storedPaste('over', { readCount: 5, viewLimit: 5 }));
      mockKV.list.mockResolvedValue({ keys: [], list_complete: true });

      const result = await repository.view(PasteId.create('over'));

      expect(result.paste).toBeNull();
      expect(mockKV.delete).toHaveBeenCalled();
    });

    it('serves content then deletes when this view hits view_limit', async () => {
      mockKV.get.mockResolvedValue(storedPaste('last', { readCount: 4, viewLimit: 5 }));
      mockKV.list.mockResolvedValue({ keys: [], list_complete: true });

      const result = await repository.view(PasteId.create('last'));

      expect(result.paste).not.toBeNull();
      expect(result.paste!.getReadCount()).toBe(5);
      expect(result.wasViewLimited).toBe(true);
      expect(mockKV.delete).toHaveBeenCalled();
    });
  });

  describe('searchPublic (KV no-op)', () => {
    it('returns empty array (KV has no search primitive)', async () => {
      const result = await repository.searchPublic('any query', 20);
      expect(result).toEqual([]);
      expect(mockKV.get).not.toHaveBeenCalled();
      expect(mockKV.list).not.toHaveBeenCalled();
    });
  });
});