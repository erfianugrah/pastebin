/**
 * Test environment polyfill for Web Crypto API
 * This file provides mock implementations for crypto functions in test environments
 */

// Simple deterministic PRNG for tests
function deterministicRandom(length: number): Uint8Array {
  const array = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    array[i] = i % 256;
  }
  return array;
}

// Mock subtle crypto implementation
const mockSubtle = {
  importKey: async (
    format: string,
    keyData: ArrayBuffer,
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[]
  ): Promise<CryptoKey> => {
    return 'mockKey' as unknown as CryptoKey;
  },
  
  deriveBits: async (
    algorithm: AlgorithmIdentifier,
    baseKey: CryptoKey,
    length: number
  ): Promise<ArrayBuffer> => {
    // Create a deterministic derived key based on algorithm params
    const mockParams = algorithm as { salt: Uint8Array, iterations: number };
    const salt = mockParams.salt;
    const saltSum = salt.reduce((acc, val) => acc + val, 0);
    
    // Create a derived key based on the salt sum
    const derivedKey = new Uint8Array(length / 8);
    for (let i = 0; i < derivedKey.length; i++) {
      derivedKey[i] = (saltSum + i) % 256;
    }
    
    return derivedKey.buffer;
  },
  
  encrypt: async (
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    data: ArrayBuffer
  ): Promise<ArrayBuffer> => {
    // Mock encryption by prepending the IV to the data
    const mockParams = algorithm as { iv: Uint8Array };
    const iv = mockParams.iv;
    const result = new Uint8Array(iv.length + data.byteLength);
    result.set(iv);
    result.set(new Uint8Array(data), iv.length);
    return result.buffer;
  },
  
  decrypt: async (
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    data: ArrayBuffer
  ): Promise<ArrayBuffer> => {
    // Mock decryption by removing the IV
    const mockParams = algorithm as { iv: Uint8Array };
    const iv = mockParams.iv;
    return data.slice(iv.length);
  }
};

// Export a function to detect if we're in a test environment
export function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'test' || 
    process.env.VITEST !== undefined || 
    typeof process !== 'undefined' && 
    process.env.JEST_WORKER_ID !== undefined
  );
}

// Function to setup the crypto polyfill for tests
export function setupTestCryptoPolyfill(): void {
  if (isTestEnvironment() && typeof globalThis !== 'undefined') {
    // Only apply if we're in a test environment and crypto is not already defined
    if (!globalThis.crypto) {
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          getRandomValues: deterministicRandom,
          subtle: mockSubtle
        },
        writable: true,
        configurable: true
      });
    } else if (!globalThis.crypto.subtle) {
      // If crypto exists but subtle doesn't, just add subtle
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: mockSubtle,
        writable: true,
        configurable: true
      });
    }
  }
}

// Try to auto-setup if in Node.js test environment
setupTestCryptoPolyfill();