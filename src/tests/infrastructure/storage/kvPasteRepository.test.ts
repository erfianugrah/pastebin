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
        isPasswordProtected: false,
        readCount: 0,
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
      mockKV.list.mockResolvedValue({ keys: [] });
      
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
      });
      
      await repository.delete(PasteId.create('abc123'));
      
      // Verify KV delete was called for both the paste and the recent list entry
      expect(mockKV.delete).toHaveBeenCalledTimes(2);
      expect(mockKV.delete).toHaveBeenCalledWith('abc123');
      expect(mockKV.delete).toHaveBeenCalledWith('recent:1672574400000:abc123');
    });
  });
});