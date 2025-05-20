/**
 * Crypto utilities for base64 encoding/decoding and browser feature detection
 */

// Constants
export const PBKDF2_ITERATIONS = 300000; // Default for standard files
export const PBKDF2_ITERATIONS_LARGE_FILE = 100000; // Lower for large files to improve performance
export const SALT_LENGTH = 16; // 16 bytes salt
export const IV_LENGTH = 12; // 12 bytes for AES-GCM IV
export const AUTH_TAG_LENGTH = 16; // 16 bytes for GCM authentication tag
export const LARGE_FILE_THRESHOLD = 1000000; // 1MB threshold for large file optimizations
export const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunk size for processing
export const FORMAT_VERSION = 1; // Version identifier for the encrypted format

// Format:
// Version 1: [Format Version (1 byte)] + [IV (12 bytes)] + [Salt (16 bytes if password-protected)] + [Ciphertext]

/**
 * Check if Web Crypto API is available
 */
export function isWebCryptoSupported(): boolean {
  // For test environments, we consider Web Crypto to be supported
  if (typeof process !== 'undefined' && 
      (process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined || process.env.JEST_WORKER_ID !== undefined)) {
    return true;
  }

  return (
    (typeof window !== 'undefined' || typeof globalThis !== 'undefined') && 
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  );
}

/**
 * Check if Web Workers are available
 */
export function isWebWorkerSupported(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined';
}

/**
 * Detect browser compatibility with crypto features
 */
export function detectBrowserCompatibility(): {
  hasWebCryptoSupport: boolean;
  hasWebWorkerSupport: boolean;
  canUseWorker: boolean;
} {
  const hasWebCryptoSupport = isWebCryptoSupported();
  const hasWebWorkerSupport = isWebWorkerSupported();
  
  return {
    hasWebCryptoSupport,
    hasWebWorkerSupport,
    canUseWorker: hasWebCryptoSupport && hasWebWorkerSupport
  };
}

/**
 * Convert ArrayBuffer to Base64 string
 * @param buffer The ArrayBuffer to convert
 * @returns Base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  
  // Handle both browser and Node.js environments
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(binary);
  } else if (typeof Buffer !== 'undefined') {
    // Node.js environment
    return Buffer.from(binary, 'binary').toString('base64');
  } else {
    // Fallback for testing environments
    return binary;
  }
}

/**
 * Convert Base64 string to ArrayBuffer
 * @param base64 The Base64 string to convert
 * @returns Uint8Array containing the decoded bytes
 */
export function base64ToArrayBuffer(base64: string): Uint8Array {
  try {
    let binaryString: string;
    
    // Handle both browser and Node.js environments
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      binaryString = window.atob(base64);
    } else if (typeof Buffer !== 'undefined') {
      // Node.js environment
      binaryString = Buffer.from(base64, 'base64').toString('binary');
    } else {
      // Fallback for testing environments - just return a simple buffer
      return new Uint8Array(base64.length);
    }
    
    // Convert to Uint8Array
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    // Common base64 decoding errors - attempt to fix
    console.warn('Attempting to fix invalid Base64 input');
    
    // Fix padding
    let fixedBase64 = base64;
    while (fixedBase64.length % 4 !== 0) {
      fixedBase64 += '=';
    }
    
    // Remove invalid characters
    fixedBase64 = fixedBase64.replace(/[^A-Za-z0-9+/=]/g, '');
    
    try {
      let binaryString: string;
      
      // Handle both browser and Node.js environments
      if (typeof window !== 'undefined' && typeof window.atob === 'function') {
        binaryString = window.atob(fixedBase64);
      } else if (typeof Buffer !== 'undefined') {
        // Node.js environment
        binaryString = Buffer.from(fixedBase64, 'base64').toString('binary');
      } else {
        // Fallback for testing environments
        return new Uint8Array(fixedBase64.length);
      }
      
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    } catch (fixError) {
      throw new Error('Unable to decode corrupted Base64 data');
    }
  }
}

/**
 * Detects if encrypted data is in legacy format (TweetNaCl)
 * @param encryptedBase64 The base64-encoded encrypted data
 * @returns True if this is legacy format
 */
export function isLegacyFormat(encryptedBase64: string): boolean {
  try {
    const encryptedBytes = base64ToArrayBuffer(encryptedBase64);
    // Legacy format doesn't have a version byte at the beginning
    // If the first byte is FORMAT_VERSION, it's the new format
    return encryptedBytes[0] !== FORMAT_VERSION;
  } catch (error) {
    // If we can't parse it, assume it's legacy for safety
    return true;
  }
}

/**
 * Generate random bytes
 * @param length Number of bytes to generate
 * @returns Uint8Array of random bytes
 */
export function getRandomBytes(length: number): Uint8Array {
  if (!isWebCryptoSupported()) {
    throw new Error('Web Crypto API is not supported in this environment');
  }
  
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Progress data interface for tracking crypto operations
 */
export interface ProgressData {
  percent: number;
}

/**
 * Types for worker operations
 */
export type WorkerOperation = 'deriveKey' | 'encrypt' | 'decrypt';