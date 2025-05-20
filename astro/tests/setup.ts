// Global test setup file
import { afterEach, beforeEach, vi } from 'vitest';

// Mock Web API globals that might not be available in test environment
if (typeof window === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encode(input: string): Uint8Array {
      const encoded = Buffer.from(input);
      return new Uint8Array(encoded);
    }
  };

  global.TextDecoder = class TextDecoder {
    decode(input: Uint8Array): string {
      return Buffer.from(input).toString();
    }
  };
}

// Set up a basic crypto object if not present
if (typeof crypto === 'undefined') {
  global.crypto = {
    getRandomValues: (array: Uint8Array): Uint8Array => {
      // Fill with deterministic values for testing
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
    subtle: {
      // Minimal stubs for crypto.subtle methods
      importKey: vi.fn(),
      deriveBits: vi.fn(),
      encrypt: vi.fn(),
      decrypt: vi.fn()
    },
    // JSDOM may not have randomUUID
    randomUUID: () => {
      return '00000000-0000-0000-0000-000000000000';
    }
  } as unknown as Crypto;
}

// Common setup before each test
beforeEach(() => {
  // Add any global setup here
});

// Common cleanup after each test
afterEach(() => {
  // Reset any mocks
  vi.restoreAllMocks();
});