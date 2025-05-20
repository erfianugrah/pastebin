/**
 * Crypto Module Shared Utilities
 * =============================
 * 
 * This file contains shared utilities and constants used across the crypto module.
 */

//----------------------------------------------------------------------
// Constants
//----------------------------------------------------------------------

/** Key length in bytes (256 bits) */
export const KEY_LENGTH = 32;

/** Nonce length in bytes (96 bits for AES-GCM) */
export const NONCE_LENGTH = 12;

/** Authentication tag length in bytes (128 bits for AES-GCM) */
export const AUTH_TAG_LENGTH = 16;

/** Salt length in bytes (128 bits for PBKDF2) */
export const SALT_LENGTH = 16;

/** High iteration count for better security */
export const PBKDF2_ITERATIONS = 300000;

/** Lower iteration count for large files to improve performance */
export const PBKDF2_ITERATIONS_LARGE_FILE = 100000;

/** Threshold for large file optimizations (1MB) */
export const LARGE_FILE_THRESHOLD = 1000000;

/** Chunk size for processing large files (1MB) */
export const CHUNK_SIZE = 1024 * 1024;

/** Timeout before terminating idle worker (60 seconds) */
export const WORKER_IDLE_TIMEOUT = 60000;

//----------------------------------------------------------------------
// String/Binary Conversion Utilities
//----------------------------------------------------------------------

/**
 * Convert a string to a Uint8Array using UTF-8 encoding
 */
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Convert a Uint8Array to a string using UTF-8 encoding
 */
export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Convert a Uint8Array to a Base64 string
 * Uses a more efficient and safer approach
 */
export function bytesToBase64(bytes: Uint8Array): string {
  // Use the browser's built-in capabilities if available (more efficient)
  if (typeof Buffer !== 'undefined') {
    // Node.js environment
    return Buffer.from(bytes).toString('base64');
  } else if (typeof btoa === 'function') {
    // Browser environment
    // Convert the bytes to a binary string first
    const binString = Array.from(bytes)
      .map(byte => String.fromCharCode(byte))
      .join('');
    return btoa(binString);
  } else {
    // Fallback for environments without btoa or Buffer
    const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    
    // Process every 3 bytes (24 bits) at a time
    for (i = 0; i < bytes.length - 2; i += 3) {
      const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      result += base64Chars[(chunk >> 18) & 63];
      result += base64Chars[(chunk >> 12) & 63];
      result += base64Chars[(chunk >> 6) & 63];
      result += base64Chars[chunk & 63];
    }
    
    // Handle remaining bytes
    if (i < bytes.length) {
      const remaining = bytes.length - i;
      let chunk = (bytes[i] << 16) | (remaining === 2 ? (bytes[i + 1] << 8) : 0);
      result += base64Chars[(chunk >> 18) & 63];
      result += base64Chars[(chunk >> 12) & 63];
      result += remaining === 2 ? base64Chars[(chunk >> 6) & 63] : '=';
      result += '=';
    }
    
    return result;
  }
}

/**
 * Convert a Base64 string to a Uint8Array
 * Uses a more efficient and safer approach
 */
export function base64ToBytes(base64: string): Uint8Array {
  // Use the browser's built-in capabilities if available (more efficient)
  if (typeof Buffer !== 'undefined') {
    // Node.js environment
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } else if (typeof atob === 'function') {
    // Browser environment
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (error) {
      // If standard atob fails (e.g., with non-ASCII chars), fall back to a manual implementation
      console.warn('Standard base64 decode failed, using fallback implementation');
      return base64ToBytesFallback(base64);
    }
  } else {
    // Fallback for environments without atob or Buffer
    return base64ToBytesFallback(base64);
  }
}

/**
 * Fallback implementation for Base64 to bytes conversion
 * Handles edge cases and non-standard Base64 strings
 */
function base64ToBytesFallback(base64: string): Uint8Array {
  // Normalize the base64 string: remove whitespace and padding
  base64 = base64.replace(/\s/g, '');
  
  // Create a lookup map for base64 characters
  const base64Lookup: Record<string, number> = {}; 
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < chars.length; i++) {
    base64Lookup[chars.charAt(i)] = i;
  }
  
  // Get the actual length of the base64 string without padding
  const len = base64.endsWith('==') ? base64.length - 2 : 
              base64.endsWith('=') ? base64.length - 1 : base64.length;
  
  // Calculate the output size
  const outLen = Math.floor((len * 3) / 4);
  const bytes = new Uint8Array(outLen);
  
  // Process 4 characters (24 bits) at a time
  let p = 0;
  for (let i = 0; i < base64.length; i += 4) {
    // Get the values of the 4 base64 characters
    const encoded1 = base64Lookup[base64.charAt(i)] || 0;
    const encoded2 = base64Lookup[base64.charAt(i + 1)] || 0;
    const encoded3 = base64Lookup[base64.charAt(i + 2)] || 0;
    const encoded4 = base64Lookup[base64.charAt(i + 3)] || 0;
    
    // Reconstruct the 3 original bytes from the 4 base64 characters
    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < outLen) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (p < outLen) bytes[p++] = ((encoded3 & 3) << 6) | encoded4;
  }
  
  return bytes;
}

//----------------------------------------------------------------------
// Binary Data Utilities
//----------------------------------------------------------------------

/**
 * Combine multiple byte arrays into a single Uint8Array
 * @param arrays The arrays to combine
 * @returns A single Uint8Array containing all input arrays
 */
export function combineBytes(...arrays: Uint8Array[]): Uint8Array {
  // Calculate the total length
  const totalLength = arrays.reduce((length, array) => length + array.byteLength, 0);
  
  // Create a new array with the total length
  const result = new Uint8Array(totalLength);
  
  // Copy all arrays into the result
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }
  
  return result;
}

/**
 * Generate random bytes using Web Crypto API
 * @param length The number of random bytes to generate
 * @returns A Uint8Array of random bytes
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Maps progress from one range to another with proper clamping
 * 
 * Used to transform raw progress values to specific ranges for different
 * operation phases (e.g., mapping 0-100% of chunk processing to 60-95% of
 * overall operation).
 * 
 * @param progress Original progress value (0-100)
 * @param startRange Start of the target range
 * @param endRange End of the target range
 * @returns Mapped progress value
 */
export function mapProgress(progress: number, startRange: number, endRange: number): number {
  // Clamp progress to 0-100 range
  const clampedProgress = Math.max(0, Math.min(100, progress));
  // Ensure start < end
  if (startRange >= endRange) return startRange;
  return startRange + Math.floor((clampedProgress / 100) * (endRange - startRange));
}

//----------------------------------------------------------------------
// Environment Detection
//----------------------------------------------------------------------

/** Browser compatibility detection result */
export interface BrowserCompatibility {
  hasWebWorkerSupport: boolean;
  hasWebCryptoSupport: boolean;
  canUseWorker: boolean;
}

/**
 * Detect browser compatibility with crypto features
 * @returns Object with compatibility flags
 */
export function detectBrowserCompatibility(): BrowserCompatibility {
  const result = {
    hasWebWorkerSupport: false,
    hasWebCryptoSupport: false,
    canUseWorker: false
  };
  
  // Check for Web Worker support
  if (typeof window !== 'undefined') {
    result.hasWebWorkerSupport = typeof Worker !== 'undefined';
    
    // Check for Web Crypto API support
    result.hasWebCryptoSupport = 
      typeof crypto !== 'undefined' && 
      typeof crypto.subtle !== 'undefined' && 
      typeof crypto.getRandomValues === 'function';
  }
  
  // Can use worker if all required features are available
  result.canUseWorker = result.hasWebWorkerSupport && result.hasWebCryptoSupport;
  
  return result;
}