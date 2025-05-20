/**
 * Tests for Base64 utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  encodeBase64, 
  decodeBase64, 
  safeDecodeBase64 
} from '../../src/lib/base64Utils';

describe('Base64 utilities', () => {
  // Test data
  const textSamples = [
    '', // Empty string
    'Hello, world!', // Basic ASCII
    'résumé', // Accented characters
    '🚀 Unicode! 😎', // Unicode/emoji
    'A'.repeat(10000), // Large text
    'Base64 encoding with + / and =' // Characters used in Base64 itself
  ];

  // Binary data samples for testing
  const binarySamples = [
    new Uint8Array([]), // Empty
    new Uint8Array([0, 1, 2, 3, 4, 5]), // Simple sequence
    new Uint8Array(Array(256).fill(0).map((_, i) => i)), // Full byte range
    new Uint8Array(1000).fill(255), // All 1s
    new Uint8Array([0xFF, 0xFE, 0xFD, 0x00, 0x01]) // Mixed values
  ];

  describe('encodeBase64', () => {
    it('should encode binary data to Base64 string', () => {
      // Test with known input/output pairs
      expect(encodeBase64(new Uint8Array([]))).toBe('');
      expect(encodeBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8='); // "hello"
      expect(encodeBase64(new Uint8Array([255, 0, 255]))).toBe('/wD/');
    });

    it('should handle all binary samples correctly', () => {
      for (const sample of binarySamples) {
        const encoded = encodeBase64(sample);
        
        // Check that the result is a string
        expect(typeof encoded).toBe('string');
        
        // Verify we can decode it back
        const decoded = decodeBase64(encoded);
        
        // Verify roundtrip integrity
        expect(decoded.length).toBe(sample.length);
        for (let i = 0; i < sample.length; i++) {
          expect(decoded[i]).toBe(sample[i]);
        }
      }
    });
  });

  describe('decodeBase64', () => {
    it('should decode Base64 string to binary data', () => {
      // Test with known input/output pairs
      expect(decodeBase64('')).toEqual(new Uint8Array([]));
      expect(decodeBase64('aGVsbG8=')).toEqual(new Uint8Array([104, 101, 108, 108, 111])); // "hello"
      expect(decodeBase64('/wD/')).toEqual(new Uint8Array([255, 0, 255]));
    });

    it('should handle URL-safe Base64 format', () => {
      const urlSafeB64 = 'abc-xyz_456';
      const standardB64 = 'abc+xyz/456';
      
      // Both should decode to the same value
      const decoded1 = decodeBase64(urlSafeB64);
      const decoded2 = decodeBase64(standardB64);
      
      expect(decoded1).toEqual(decoded2);
    });

    it('should handle padding correctly', () => {
      // Base64 normally uses = for padding
      const withPadding = 'aGVsbG8=';
      const withoutPadding = 'aGVsbG8';
      
      // Both should decode to "hello"
      expect(decodeBase64(withPadding)).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
      expect(decodeBase64(withoutPadding)).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
    });

    it('should handle invalid Base64 input', () => {
      // Our implementation is lenient by design, so we should test that it
      // doesn't throw for invalid input but returns something
      const result = decodeBase64('!@#$');
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('safeDecodeBase64', () => {
    it('should decode valid Base64 content', () => {
      const base64 = 'aGVsbG8='; // "hello"
      const expected = new Uint8Array([104, 101, 108, 108, 111]);
      
      expect(safeDecodeBase64(base64)).toEqual(expected);
    });

    it('should handle URL-safe character variants', () => {
      const urlSafe = 'abc-xyz_123';
      const standard = 'abc+xyz/123';
      
      const decoded1 = safeDecodeBase64(urlSafe);
      const decoded2 = safeDecodeBase64(standard);
      
      expect(decoded1).toEqual(decoded2);
    });

    it('should handle missing padding', () => {
      const withoutPadding = 'aGVsbG8';
      const expected = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
      
      expect(safeDecodeBase64(withoutPadding)).toEqual(expected);
    });

    it('should recover from whitespace in the string', () => {
      const withWhitespace = 'aGVs bG8=';
      const expected = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
      
      expect(safeDecodeBase64(withWhitespace)).toEqual(expected);
    });

    it('should attempt to recover from invalid characters', () => {
      const withInvalid = 'aGV!sbG8=';
      
      // This should not throw but recover as best it can
      const result = safeDecodeBase64(withInvalid);
      
      // The result might not be perfect, but should be a Uint8Array
      expect(result instanceof Uint8Array).toBe(true);
    });
  });

  describe('roundtrip conversion', () => {
    it('should maintain integrity for all text samples', () => {
      for (const sample of textSamples) {
        // Convert to binary first
        const binary = new TextEncoder().encode(sample);
        
        // Encode to Base64
        const base64 = encodeBase64(binary);
        
        // Decode back to binary
        const decodedBinary = decodeBase64(base64);
        
        // Convert back to text
        const decodedText = new TextDecoder().decode(decodedBinary);
        
        // Verify roundtrip
        expect(decodedText).toBe(sample);
      }
    });

    it('should maintain integrity for all binary samples', () => {
      for (const sample of binarySamples) {
        // Encode to Base64
        const base64 = encodeBase64(sample);
        
        // Decode back to binary
        const decoded = decodeBase64(base64);
        
        // Verify arrays are the same
        expect(decoded.length).toBe(sample.length);
        for (let i = 0; i < sample.length; i++) {
          expect(decoded[i]).toBe(sample[i]);
        }
      }
    });
  });
});