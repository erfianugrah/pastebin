/**
 * Enhanced client-side encryption utilities for pastes using TweetNaCl.js and Web Crypto API
 * Implements true end-to-end encryption (E2EE) with modern cryptography standards
 * Now with Web Worker support for better performance on large pastes
 * Optimized with chunked processing for large files
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

// Extract functions from the CommonJS module
const { encodeBase64, decodeBase64: originalDecodeBase64 } = util;

// Constants
const PBKDF2_ITERATIONS = 300000; // High iteration count for better security
const PBKDF2_ITERATIONS_LARGE_FILE = 100000; // Lower for large files to improve performance
const SALT_LENGTH = 16; // 16 bytes salt
const KEY_LENGTH = nacl.secretbox.keyLength; // 32 bytes for NaCl secretbox
const LARGE_FILE_THRESHOLD = 1000000; // 1MB threshold for large file optimizations
const CHUNK_SIZE = 1024 * 1024; // 1MB chunk size for processing

// Create a safe decodeBase64 function that handles invalid inputs
function safeDecodeBase64(input: string): Uint8Array {
  try {
    // Try standard decoding first
    return originalDecodeBase64(input);
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid encoding')) {
      console.warn('Fixing invalid Base64 encoding in input');
      
      // Fix common Base64 issues:
      // 1. Ensure length is multiple of 4 by adding padding
      let fixedInput = input;
      while (fixedInput.length % 4 !== 0) {
        fixedInput += '=';
      }
      
      // 2. Replace any invalid characters with 'A'
      fixedInput = fixedInput.replace(/[^A-Za-z0-9+/=]/g, 'A');
      
      try {
        const result = originalDecodeBase64(fixedInput);
        console.log('Successfully fixed and decoded Base64 input');
        return result;
      } catch (fixError) {
        console.error('Failed to fix Base64 encoding:', fixError);
        throw new Error('Unable to decode corrupted Base64 data. The encryption key may be invalid or the data is corrupted.');
      }
    }
    throw error;
  }
}

// Replace all uses of originalDecodeBase64 with safeDecodeBase64
const decodeBase64 = safeDecodeBase64;

// Browser feature detection and compatibility
interface BrowserCompatibility {
  hasWebWorkerSupport: boolean;
  hasWebCryptoSupport: boolean;
  hasTweetNaclSupport: boolean;
  canUseWorker: boolean;
}

/**
 * Incrementally decode Base64 string in chunks (main thread implementation)
 * @param input The Base64 string to decode
 * @param chunkSize Size of each chunk to process
 * @param onProgress Callback for progress reporting
 */
async function incrementalBase64Decode(
  input: string, 
  chunkSize: number = CHUNK_SIZE,
  onProgress?: (processed: number, total: number) => void
): Promise<Uint8Array> {
  const total = input.length;
  const numChunks = Math.ceil(total / chunkSize);
  let processedBytes = 0;
  
  // First, calculate the exact length of the output buffer
  // Base64 decoding: 4 chars → 3 bytes (with padding)
  const outputLength = Math.floor((input.length * 3) / 4);
  const result = new Uint8Array(outputLength);
  
  let resultOffset = 0;
  
  for (let i = 0; i < numChunks; i++) {
    // Get next chunk
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, total);
    const chunk = input.slice(start, end);
    
    // Ensure chunk is valid base64 (multiple of 4)
    let paddedChunk = chunk;
    // Only add padding if this is the last chunk
    if (i === numChunks - 1) {
      while (paddedChunk.length % 4 !== 0) {
        paddedChunk += '=';
      }
    }
    
    // Decode chunk
    const decodedChunk = decodeBase64(paddedChunk);
    
    // Copy to result buffer
    result.set(decodedChunk, resultOffset);
    resultOffset += decodedChunk.length;
    
    // Report progress
    processedBytes += (end - start);
    if (onProgress) {
      onProgress(processedBytes, total);
    }
    
    // Allow UI to update between chunks
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  // Return the actual data (might be slightly smaller than allocated due to padding)
  return result.slice(0, resultOffset);
}

/**
 * Detect browser compatibility with our crypto features
 * @returns Object with compatibility flags
 */
function detectBrowserCompatibility(): BrowserCompatibility {
  const result = {
    hasWebWorkerSupport: false,
    hasWebCryptoSupport: false,
    hasTweetNaclSupport: true, // Assume true as this is a bundled dependency
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

// Detect compatibility once at module load time
const browserCompatibility = detectBrowserCompatibility();
console.log('Browser compatibility:', browserCompatibility);

// Worker management
type WorkerOperation = 'deriveKey' | 'encrypt' | 'decrypt';
type RequestId = string;
let worker: Worker | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;
const WORKER_IDLE_TIMEOUT = 60000; // 60 seconds before terminating idle worker
const pendingRequests = new Map<RequestId, { 
  resolve: (value: any) => void; 
  reject: (reason: any) => void; 
}>();

// Track operation progress
interface ProgressData {
  operation: WorkerOperation;
  total: number;
  processed: number;
  requestId: string;
}
const progressCallbacks = new Map<RequestId, (progress: ProgressData) => void>();

/**
 * Initialize the Web Worker for crypto operations
 * Creating a worker is expensive, so we only create it when needed and reuse it
 */
function initWorker(): Worker {
  if (typeof window === 'undefined') {
    throw new Error('Web Workers can only be used in browser environments');
  }
  
  if (!browserCompatibility.canUseWorker) {
    throw new Error('Web Workers or Web Crypto API not supported in this browser');
  }
  
  if (!worker) {
    console.log('Creating new Web Worker for crypto operations');
    
    // Create the worker
    worker = new Worker(new URL('./crypto-worker.ts', import.meta.url), { type: 'module' });
    
    // Handle messages from the worker
    worker.onmessage = (event: MessageEvent) => {
      const { success, result, error, requestId, progress } = event.data;
      
      // Handle progress updates
      if (progress) {
        const progressCallback = progressCallbacks.get(requestId);
        if (progressCallback) {
          progressCallback(progress);
        }
        return; // This is just a progress update, not a completion
      }
      
      // Find the pending request
      const request = pendingRequests.get(requestId);
      if (!request) {
        console.error('Received response for unknown request ID:', requestId);
        return;
      }
      
      // Resolve or reject the request
      if (success) {
        request.resolve(result);
      } else {
        request.reject(new Error(error));
      }
      
      // Remove the request and its progress callback from the maps
      pendingRequests.delete(requestId);
      progressCallbacks.delete(requestId);
      
      // Start idle timer if no more pending requests
      if (pendingRequests.size === 0) {
        scheduleWorkerTermination();
      }
    };
    
    // Handle worker errors
    worker.onerror = (event: ErrorEvent) => {
      console.error('Web Worker error:', event);
      
      // Reject all pending requests
      pendingRequests.forEach((request, requestId) => {
        request.reject(new Error('Worker error: ' + (event.message || 'Unknown error')));
        pendingRequests.delete(requestId);
        progressCallbacks.delete(requestId);
      });
      
      // Terminate the worker
      terminateWorker();
    };
  } else {
    // If we have a pending termination, cancel it
    if (workerIdleTimer) {
      clearTimeout(workerIdleTimer);
      workerIdleTimer = null;
    }
  }
  
  return worker;
}

/**
 * Schedule worker termination after idle timeout
 */
function scheduleWorkerTermination() {
  // Clear any existing timer
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
  }
  
  // Set new timer
  workerIdleTimer = setTimeout(() => {
    terminateWorker();
  }, WORKER_IDLE_TIMEOUT);
}

/**
 * Terminate the worker and clean up resources
 */
function terminateWorker() {
  if (worker) {
    console.log('Terminating idle Web Worker');
    worker.terminate();
    worker = null;
  }
  
  if (workerIdleTimer) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
}

/**
 * Send a task to the Web Worker
 * @param operation The operation to perform
 * @param params The parameters for the operation
 * @param onProgress Optional callback for progress updates
 * @returns A promise that resolves with the operation result
 */
async function executeInWorker<T>(
  operation: WorkerOperation, 
  params: any, 
  onProgress?: (progress: ProgressData) => void
): Promise<T> {
  // If browser doesn't support workers or Web Crypto, fall back to main thread
  if (!browserCompatibility.canUseWorker || typeof window === 'undefined') {
    console.log('Worker not supported, using main thread for', operation);
    return fallbackToMainThread<T>(operation, params);
  }
  
  try {
    // Try to use the worker
    const worker = initWorker();
    
    // Generate a unique request ID
    const requestId = Math.random().toString(36).substring(2, 15);
    
    // Create a promise that will be resolved when the worker responds
    const promise = new Promise<T>((resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
    });
    
    // Register progress callback if provided
    if (onProgress) {
      progressCallbacks.set(requestId, onProgress);
    }

    // Add additional parameters for optimization
    const isLargeOperation = 
      (operation === 'decrypt' && params.encrypted?.length > LARGE_FILE_THRESHOLD) ||
      (operation === 'encrypt' && params.data?.length > LARGE_FILE_THRESHOLD);
    
    // Add timing info to the message for large operations
    const enhancedParams = { 
      ...params, 
      reportProgress: !!onProgress,
      isLargeFile: isLargeOperation
    };
    
    // Send the message to the worker
    worker.postMessage({ operation, params: enhancedParams, requestId });
    
    // Wait for the worker to respond
    return await promise;
  } catch (error) {
    console.warn('Worker execution failed, falling back to main thread:', error);
    return fallbackToMainThread<T>(operation, params);
  }
}

/**
 * Fall back to main thread implementation when worker is unavailable
 */
async function fallbackToMainThread<T>(operation: WorkerOperation, params: any): Promise<T> {
  // If the worker failed, fall back to the main thread implementation
  switch (operation) {
    case 'deriveKey':
      return await deriveKeyFromPasswordMain(
        params.password, 
        params.salt, 
        params.isLargeFile || false
      ) as T;
    case 'encrypt':
      return await encryptDataMain(
        params.data, 
        params.key, 
        params.isPasswordDerived, 
        params.salt
      ) as T;
    case 'decrypt':
      return await decryptDataMain(
        params.encrypted, 
        params.key, 
        params.isPasswordProtected,
        params.onProgress
      ) as T;
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Generate a random encryption key
 * @returns Base64-encoded encryption key
 */
export function generateEncryptionKey(): string {
  const key = nacl.randomBytes(KEY_LENGTH);
  return encodeBase64(key);
}

/**
 * Main thread implementation of deriveKeyFromPassword
 * Used as a fallback if the worker fails
 * Now with adaptive iteration count based on file size
 */
async function deriveKeyFromPasswordMain(
  password: string, 
  saltBase64?: string,
  isLargeFile: boolean = false
): Promise<{ key: string, salt: string }> {
  try {
    // Generate salt if not provided
    const salt = saltBase64 
      ? decodeBase64(saltBase64)
      : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    
    // Convert password to a format usable by Web Crypto API
    const passwordEncoder = new TextEncoder();
    const passwordBuffer = passwordEncoder.encode(password);
    
    // Import the password as a key
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey', 'deriveBits']
    );
    
    // Use adaptive iteration count based on file size for performance
    const iterations = isLargeFile ? PBKDF2_ITERATIONS_LARGE_FILE : PBKDF2_ITERATIONS;
    
    // Use PBKDF2 to derive a key
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256'
      },
      passwordKey,
      KEY_LENGTH * 8 // Key length in bits (32 bytes * 8)
    );
    
    // Convert the derived bits to a Uint8Array for TweetNaCl
    const derivedKey = new Uint8Array(derivedBits);
    
    return {
      key: encodeBase64(derivedKey),
      salt: encodeBase64(salt)
    };
  } catch (error) {
    console.error('Key derivation error:', error);
    throw new Error('Failed to derive key from password: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Main thread implementation of encryptData
 * Used as a fallback if the worker fails
 */
async function encryptDataMain(
  data: string, 
  keyBase64: string, 
  isPasswordDerived = false, 
  saltBase64?: string
): Promise<string> {
  // Only log sensitive crypto operations in development
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    console.log('Encrypting data of length:', data.length);
    console.log('Using key:', keyBase64.substring(0, 5) + '...');
  }
  
  try {
    // Decode the key from base64
    const key = decodeBase64(keyBase64);
    // Only log in development
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      console.log('Decoded key length:', key.length);
    }
    
    if (key.length !== KEY_LENGTH) {
      console.error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // Convert content to Uint8Array
    const messageUint8 = new TextEncoder().encode(data);
    console.log('Message bytes length:', messageUint8.length);
    
    // Create nonce (unique value for each encryption)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    console.log('Generated nonce length:', nonce.length);
    
    // Encrypt the data
    const encryptedData = nacl.secretbox(messageUint8, nonce, key);
    console.log('Encrypted data length:', encryptedData.length);
    
    // If this encryption used a password-derived key, include the salt in the output
    let finalEncryptedMessage: Uint8Array;
    if (isPasswordDerived && saltBase64) {
      const salt = decodeBase64(saltBase64);
      finalEncryptedMessage = new Uint8Array(salt.length + nonce.length + encryptedData.length);
      finalEncryptedMessage.set(salt); // First 16 bytes: salt
      finalEncryptedMessage.set(nonce, salt.length); // Next 24 bytes: nonce
      finalEncryptedMessage.set(encryptedData, salt.length + nonce.length); // Remainder: ciphertext
      console.log('Combined message with salt length:', finalEncryptedMessage.length);
    } else {
      // Standard encryption with just nonce + ciphertext
      finalEncryptedMessage = new Uint8Array(nonce.length + encryptedData.length);
      finalEncryptedMessage.set(nonce); // First 24 bytes: nonce
      finalEncryptedMessage.set(encryptedData, nonce.length); // Remainder: ciphertext
      console.log('Combined message length:', finalEncryptedMessage.length);
    }
    
    // Encode for storage and transport
    const result = encodeBase64(finalEncryptedMessage);
    console.log('Base64 result length:', result.length);
    
    return result;
  } catch (error) {
    console.error('Encryption error:', error);
    throw error;
  }
}

/**
 * Main thread implementation of decryptData
 * Optimized for large files using chunked processing
 */
async function decryptDataMain(
  encryptedBase64: string, 
  keyBase64: string, 
  isPasswordProtected = false,
  progressCallback?: (progress: { percent: number }) => void
): Promise<string> {
  // Only log sensitive crypto operations in development
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    console.log('Decrypting data of length:', encryptedBase64.length);
    console.log('Using key:', keyBase64.substring(0, 5) + '...');
  }
  
  try {
    const isLargeFile = encryptedBase64.length > LARGE_FILE_THRESHOLD;
    
    // For large files, use incremental decoding to reduce memory pressure
    const encryptedMessage = isLargeFile
      ? await incrementalBase64Decode(
          encryptedBase64,
          CHUNK_SIZE,
          progressCallback ? (processed, total) => {
            progressCallback({
              percent: Math.round((processed / total) * 50) // Base64 decoding is ~50% of the work
            });
          } : undefined
        )
      : decodeBase64(encryptedBase64);
    
    console.log('Decoded message length:', encryptedMessage.length);
    
    let key: Uint8Array;
    let nonce: Uint8Array;
    let ciphertext: Uint8Array;
    
    // Report progress after base64 decoding
    if (progressCallback && isLargeFile) {
      progressCallback({ percent: 50 });
    }
    
    if (isPasswordProtected) {
      // Extract salt, nonce, and ciphertext from the encrypted message
      // Format: [salt(16) + nonce(24) + ciphertext]
      const salt = encryptedMessage.slice(0, SALT_LENGTH);
      nonce = encryptedMessage.slice(SALT_LENGTH, SALT_LENGTH + nacl.secretbox.nonceLength);
      ciphertext = encryptedMessage.slice(SALT_LENGTH + nacl.secretbox.nonceLength);
      
      // Derive key from password using the extracted salt
      // Use adaptive iteration count for large files
      const { key: derivedKeyBase64 } = await deriveKeyFromPasswordMain(keyBase64, encodeBase64(salt), isLargeFile);
      key = decodeBase64(derivedKeyBase64);
      
      // Report progress after key derivation
      if (progressCallback && isLargeFile) {
        progressCallback({ percent: 75 });
      }
    } else {
      // Direct key decryption
      // Format: [nonce(24) + ciphertext]
      key = decodeBase64(keyBase64);
      nonce = encryptedMessage.slice(0, nacl.secretbox.nonceLength);
      ciphertext = encryptedMessage.slice(nacl.secretbox.nonceLength);
      
      // Skip the key derivation progress update
      if (progressCallback && isLargeFile) {
        progressCallback({ percent: 75 });
      }
    }
    
    console.log('Extracted nonce length:', nonce.length);
    console.log('Extracted ciphertext length:', ciphertext.length);
    
    if (key.length !== KEY_LENGTH) {
      console.error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // Decrypt the data
    const decryptedData = nacl.secretbox.open(ciphertext, nonce, key);
    
    if (!decryptedData) {
      console.error('Decryption failed - invalid key or corrupted data');
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    
    // Only log in development
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      console.log('Decrypted data length:', decryptedData.length);
    }
    
    // Convert back to string in chunks for large data
    let result = '';
    if (isLargeFile && decryptedData.length > CHUNK_SIZE) {
      const decoder = new TextDecoder();
      const chunks = Math.ceil(decryptedData.length / CHUNK_SIZE);
      
      for (let i = 0; i < chunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, decryptedData.length);
        const chunk = decryptedData.slice(start, end);
        
        // Use streaming mode for TextDecoder to handle large strings efficiently
        result += decoder.decode(chunk, { stream: i < chunks - 1 });
        
        // Report progress during string conversion
        if (progressCallback) {
          const percent = 75 + (i / chunks) * 25; // 75-100%
          progressCallback({ percent: Math.round(percent) });
        }
        
        // Allow UI to update between chunks
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } else {
      // For smaller data, decode all at once
      result = new TextDecoder().decode(decryptedData);
      
      // Final progress update
      if (progressCallback) {
        progressCallback({ percent: 100 });
      }
    }
    
    console.log('Decrypted string length:', result.length);
    
    return result;
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

// Register cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (worker) {
      console.log('Page unloading, terminating worker');
      terminateWorker();
    }
  });
}

/**
 * Public API: Derive an encryption key from a password using PBKDF2
 * Uses Web Worker for improved performance
 * 
 * @param password The password to derive the key from
 * @param saltBase64 Optional salt (will be randomly generated if not provided)
 * @param progressCallback Optional callback for progress updates
 * @returns Object containing the derived key and salt (both base64 encoded)
 */
export async function deriveKeyFromPassword(
  password: string, 
  saltBase64?: string,
  progressCallback?: (progress: { percent: number }) => void
): Promise<{ key: string, salt: string }> {
  // Skip worker for server-side rendering
  if (typeof window === 'undefined') {
    return deriveKeyFromPasswordMain(password, saltBase64);
  }
  
  // Detect if this is for a large file operation
  const isLargeFile = false; // Default for key derivation alone
  
  // Use the worker for client-side rendering
  try {
    // Only log in development
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      console.log('Deriving key from password using Web Worker');
    }
    
    // Wrap the progress callback to report percentage
    const onProgress = progressCallback
      ? (progress: ProgressData) => {
          progressCallback({
            percent: Math.round((progress.processed / progress.total) * 100)
          });
        }
      : undefined;
    
    return await executeInWorker<{ key: string, salt: string }>(
      'deriveKey', 
      { password, salt: saltBase64, isLargeFile },
      onProgress
    );
  } catch (error) {
    console.error('Worker-based key derivation failed, using main thread:', error);
    return deriveKeyFromPasswordMain(password, saltBase64, isLargeFile);
  }
}

/**
 * Public API: Encrypt data using NaCl secretbox (XSalsa20-Poly1305)
 * Uses Web Worker for improved performance
 * 
 * @param data The text to encrypt
 * @param keyBase64 The base64-encoded encryption key
 * @param isPasswordDerived Whether this key was derived from a password
 * @param saltBase64 The salt used for password derivation (required if isPasswordDerived is true)
 * @param progressCallback Optional callback for progress updates
 * @returns Base64-encoded encrypted data (nonce + ciphertext) or (salt + nonce + ciphertext) if password-derived
 */
export async function encryptData(
  data: string, 
  keyBase64: string, 
  isPasswordDerived = false, 
  saltBase64?: string,
  progressCallback?: (progress: { percent: number }) => void
): Promise<string> {
  // Skip worker for server-side rendering or small data
  if (typeof window === 'undefined' || data.length < LARGE_FILE_THRESHOLD / 10) {
    return encryptDataMain(data, keyBase64, isPasswordDerived, saltBase64);
  }
  
  // Use the worker for client-side rendering with larger data
  try {
    const isLargeData = data.length >= LARGE_FILE_THRESHOLD;
    
    if (isLargeData) {
      console.log(`Encrypting large data (${Math.round(data.length/1024)}KB) using Web Worker with progress reporting`);
    } else {
      console.log('Encrypting data using Web Worker');
    }
    
    // Wrap the progress callback to report percentage
    const onProgress = (isLargeData && progressCallback)
      ? (progress: ProgressData) => {
          progressCallback({
            percent: Math.round((progress.processed / progress.total) * 100)
          });
        }
      : undefined;
    
    return await executeInWorker<string>(
      'encrypt', 
      { 
        data, 
        key: keyBase64, 
        isPasswordDerived, 
        salt: saltBase64 
      },
      onProgress
    );
  } catch (error) {
    console.error('Worker-based encryption failed, using main thread:', error);
    return encryptDataMain(data, keyBase64, isPasswordDerived, saltBase64);
  }
}

/**
 * Public API: Decrypt data that was encrypted with encryptData
 * Uses Web Worker for improved performance with chunked processing for large files
 * 
 * @param encryptedBase64 The base64-encoded encrypted data
 * @param keyBase64 The base64-encoded encryption key, or password for password-protected content
 * @param isPasswordProtected Whether this content was encrypted with a password
 * @param progressCallback Optional callback for progress updates
 * @returns Decrypted data as string
 */
export async function decryptData(
  encryptedBase64: string, 
  keyBase64: string, 
  isPasswordProtected = false,
  progressCallback?: (progress: { percent: number }) => void
): Promise<string> {
  // Skip worker for server-side rendering or very small data
  if (typeof window === 'undefined' || encryptedBase64.length < LARGE_FILE_THRESHOLD / 10) {
    return decryptDataMain(encryptedBase64, keyBase64, isPasswordProtected, progressCallback);
  }
  
  // Use the worker for client-side rendering with sufficient data size
  try {
    const isLargeData = encryptedBase64.length >= LARGE_FILE_THRESHOLD;
    
    if (isLargeData) {
      console.log(`Decrypting large data (${Math.round(encryptedBase64.length/1024)}KB) using Web Worker with chunked processing`);
    } else {
      console.log('Decrypting data using Web Worker');
    }
    
    // Wrap the progress callback to report percentage
    const onProgress = progressCallback
      ? (progress: ProgressData) => {
          progressCallback({
            percent: Math.round((progress.processed / progress.total) * 100)
          });
        }
      : undefined;
    
    return await executeInWorker<string>(
      'decrypt', 
      { 
        encrypted: encryptedBase64, 
        key: keyBase64, 
        isPasswordProtected 
      },
      onProgress
    );
  } catch (error) {
    console.error('Worker-based decryption failed, using main thread:', error);
    return decryptDataMain(encryptedBase64, keyBase64, isPasswordProtected, progressCallback);
  }
}