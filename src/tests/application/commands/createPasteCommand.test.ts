import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreatePasteCommand, CreatePasteParams } from '../../../application/commands/createPasteCommand';
import { PasteRepository } from '../../../domain/repositories/pasteRepository';
import { UniqueIdService } from '../../../domain/services/uniqueIdService';
import { ExpirationService } from '../../../domain/services/expirationService';
import { Paste, PasteId, ExpirationPolicy } from '../../../domain/models/paste';

// Mock dependencies
const mockRepository: PasteRepository = {
  save: vi.fn(),
  findById: vi.fn(),
  delete: vi.fn(),
  findRecentPublic: vi.fn(),
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
    expect(result).toEqual({
      id: 'abc123',
      url: 'https://pastebin.example.com/pastes/abc123',
      expiresAt: savedPaste.getExpiresAt().toISOString(),
    });
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
    expect(result).toEqual({
      id: 'abc123',
      url: 'https://pastebin.example.com/pastes/abc123',
      expiresAt: savedPaste.getExpiresAt().toISOString(),
    });
  });
  
  it('should throw an error if content is empty', async () => {
    const params: any = {
      content: '',
    };
    
    await expect(command.execute(params)).rejects.toThrow();
  });
});