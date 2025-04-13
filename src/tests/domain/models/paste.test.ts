import { describe, it, expect } from 'vitest';
import { Paste, PasteId, ExpirationPolicy, Visibility } from '../../../domain/models/paste';

describe('PasteId', () => {
  it('should create a PasteId', () => {
    const id = PasteId.create('123');
    expect(id.toString()).toBe('123');
  });

  it('should compare two PasteIds', () => {
    const id1 = PasteId.create('123');
    const id2 = PasteId.create('123');
    const id3 = PasteId.create('456');

    expect(id1.equals(id2)).toBe(true);
    expect(id1.equals(id3)).toBe(false);
  });
});

describe('ExpirationPolicy', () => {
  it('should create an expiration policy with valid seconds', () => {
    const policy = ExpirationPolicy.create(3600);
    expect(policy.getSeconds()).toBe(3600);
  });

  it('should throw an error when creating with negative seconds', () => {
    expect(() => ExpirationPolicy.create(-1)).toThrow('Expiration must be greater than 0');
  });

  it('should create a default expiration policy (1 day)', () => {
    const policy = ExpirationPolicy.createDefault();
    expect(policy.getSeconds()).toBe(86400);
  });

  it('should create a "never" expiration policy', () => {
    const policy = ExpirationPolicy.createNever();
    expect(policy.getSeconds()).toBe(315360000);
  });

  it('should calculate expiration date correctly', () => {
    const policy = ExpirationPolicy.create(3600);
    const now = new Date('2023-01-01T12:00:00Z');
    const expected = new Date('2023-01-01T13:00:00Z');
    
    expect(policy.getExpirationDate(now).toISOString()).toBe(expected.toISOString());
  });

  it('should determine if a paste has expired', () => {
    const policy = ExpirationPolicy.create(3600);
    const creationDate = new Date('2023-01-01T12:00:00Z');
    
    // Not expired yet
    const beforeExpiration = new Date('2023-01-01T12:59:59Z');
    expect(policy.hasExpired(creationDate, beforeExpiration)).toBe(false);
    
    // Expired
    const afterExpiration = new Date('2023-01-01T13:00:01Z');
    expect(policy.hasExpired(creationDate, afterExpiration)).toBe(true);
  });
});

describe('Paste', () => {
  it('should create a paste with required fields', () => {
    const id = PasteId.create('123');
    const paste = Paste.create(id, 'content');
    
    expect(paste.getId()).toBe(id);
    expect(paste.getContent()).toBe('content');
    expect(paste.getVisibility()).toBe('public');
    expect(paste.getExpirationPolicy().getSeconds()).toBe(86400);
  });

  it('should create a paste with all fields', () => {
    const id = PasteId.create('123');
    const expirationPolicy = ExpirationPolicy.create(3600);
    const paste = Paste.create(
      id,
      'content',
      expirationPolicy,
      'title',
      'javascript',
      'private' as Visibility,
    );
    
    expect(paste.getId()).toBe(id);
    expect(paste.getContent()).toBe('content');
    expect(paste.getTitle()).toBe('title');
    expect(paste.getLanguage()).toBe('javascript');
    expect(paste.getVisibility()).toBe('private');
    expect(paste.getExpirationPolicy()).toBe(expirationPolicy);
  });

  it('should determine if a paste has expired', () => {
    const id = PasteId.create('123');
    const expirationPolicy = ExpirationPolicy.create(3600);
    
    const paste = new Paste(
      id,
      'content',
      new Date('2023-01-01T12:00:00Z'),
      expirationPolicy,
    );
    
    // Not expired yet
    expect(paste.hasExpired(new Date('2023-01-01T12:59:59Z'))).toBe(false);
    
    // Expired
    expect(paste.hasExpired(new Date('2023-01-01T13:00:01Z'))).toBe(true);
  });

  it('should serialize to JSON correctly', () => {
    const id = PasteId.create('123');
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
    
    const json = paste.toJSON();
    
    expect(json).toEqual({
      id: '123',
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
  });
});