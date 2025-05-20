/**
 * Web Worker Manager for Cryptographic Operations
 * ==============================================
 * 
 * This module manages the lifecycle of Web Workers used for cryptographic operations.
 * It handles worker creation, message passing, and provides fallback implementations
 * when workers are not available.
 */

import {
  WORKER_IDLE_TIMEOUT,
  LARGE_FILE_THRESHOLD,
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_LARGE_FILE,
  detectBrowserCompatibility,
  combineBytes,
  stringToBytes,
  bytesToString,
  SALT_LENGTH,
  NONCE_LENGTH
} from './utils';

import {
  deriveKey,
  encrypt,
  decrypt
} from './core';

import {
  WorkerOperation,
  RequestId,
  ProgressData,
  ProgressCallback,
  KeyDerivationResult
} from './types';

//----------------------------------------------------------------------
// Browser Compatibility Detection
//----------------------------------------------------------------------

// Detect compatibility once at module load time
const browserCompatibility = detectBrowserCompatibility();
console.log('Browser crypto compatibility:', browserCompatibility);

//----------------------------------------------------------------------
// Worker Management
//----------------------------------------------------------------------

// Worker state management
let worker: Worker | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;

// Request tracking
const pendingRequests = new Map<RequestId, { 
  resolve: (value: any) => void; 
  reject: (reason: any) => void; 
}>();

// Progress tracking
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
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    
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
      (operation === 'decrypt' && params.encrypted?.byteLength > LARGE_FILE_THRESHOLD) ||
      (operation === 'encrypt' && params.data?.byteLength > LARGE_FILE_THRESHOLD);
    
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

//----------------------------------------------------------------------
// Main Thread Fallback Implementations
//----------------------------------------------------------------------

/**
 * Fall back to main thread implementation when worker is unavailable
 */
async function fallbackToMainThread<T>(operation: WorkerOperation, params: any): Promise<T> {
  switch (operation) {
    case 'deriveKey':
      return await deriveKeyMain(
        params.password, 
        params.salt, 
        params.isLargeFile || false
      ) as T;
    case 'encrypt':
      return await encryptMain(
        params.data, 
        params.key, 
        params.isPasswordDerived, 
        params.salt
      ) as T;
    case 'decrypt':
      return await decryptMain(
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
 * Main thread implementation of key derivation
 */
async function deriveKeyMain(
  password: string, 
  salt?: Uint8Array,
  isLargeFile: boolean = false
): Promise<KeyDerivationResult> {
  try {
    // Use adaptive iteration count based on file size for performance
    const iterations = isLargeFile ? PBKDF2_ITERATIONS_LARGE_FILE : PBKDF2_ITERATIONS;
    
    // Derive the key
    return await deriveKey(password, salt, iterations);
  } catch (error) {
    console.error('Key derivation error:', error);
    throw new Error('Failed to derive key from password: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Main thread implementation of encryption
 */
async function encryptMain(
  data: Uint8Array, 
  key: Uint8Array, 
  isPasswordDerived = false, 
  salt?: Uint8Array
): Promise<Uint8Array> {
  console.log('Encrypting data of length:', data.byteLength);
  
  try {
    // Create nonce and encrypt the data using AES-GCM
    const { ciphertext, nonce } = await encrypt(data, key);
    
    // If this encryption used a password-derived key, include the salt in the output
    if (isPasswordDerived && salt) {
      return combineBytes(salt, nonce, new Uint8Array(ciphertext));
    } else {
      // Standard encryption with just nonce + ciphertext
      return combineBytes(nonce, new Uint8Array(ciphertext));
    }
  } catch (error) {
    console.error('Encryption error:', error);
    throw error;
  }
}

/**
 * Main thread implementation of decryption
 */
async function decryptMain(
  encryptedData: Uint8Array, 
  key: Uint8Array | string, 
  isPasswordProtected = false,
  progressCallback?: ProgressCallback
): Promise<Uint8Array> {
  console.log('Decrypting data of length:', encryptedData.byteLength);
  
  try {
    let keyBytes: Uint8Array;
    let nonce: Uint8Array;
    let ciphertext: Uint8Array;
    
    // Report initial progress
    if (progressCallback) {
      progressCallback({ percent: 0 });
    }
    
    if (isPasswordProtected) {
      // Extract salt, nonce, and ciphertext from the encrypted message
      // Format: [salt(16) + nonce(12) + ciphertext]
      const salt = encryptedData.slice(0, SALT_LENGTH);
      nonce = encryptedData.slice(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH);
      ciphertext = encryptedData.slice(SALT_LENGTH + NONCE_LENGTH);
      
      // For password-protected content, key is a password string
      const password = typeof key === 'string' ? key : bytesToString(key);
      
      // Report progress before key derivation
      if (progressCallback) {
        progressCallback({ percent: 10 });
      }
      
      // Derive key from password using the extracted salt
      const isLargeFile = encryptedData.byteLength > LARGE_FILE_THRESHOLD;
      const { key: derivedKey } = await deriveKeyMain(password, salt, isLargeFile);
      keyBytes = derivedKey;
      
      // Report progress after key derivation
      if (progressCallback) {
        progressCallback({ percent: 50 });
      }
    } else {
      // For key-encrypted content, key should be a Uint8Array
      keyBytes = typeof key === 'string' ? stringToBytes(key) : key;
      
      // Format: [nonce(12) + ciphertext]
      nonce = encryptedData.slice(0, NONCE_LENGTH);
      ciphertext = encryptedData.slice(NONCE_LENGTH);
      
      // Report progress (skip the key derivation step)
      if (progressCallback) {
        progressCallback({ percent: 25 });
      }
    }
    
    // Import the key for AES-GCM
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    
    // Report progress after key import
    if (progressCallback) {
      progressCallback({ percent: 60 });
    }
    
    // Decrypt the data
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        tagLength: 128 // Standard tag length for AES-GCM
      },
      cryptoKey,
      ciphertext
    );
    
    // Report progress after decryption
    if (progressCallback) {
      progressCallback({ percent: 90 });
    }
    
    // Final progress update
    if (progressCallback) {
      progressCallback({ percent: 100 });
    }
    
    return new Uint8Array(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

//----------------------------------------------------------------------
// Register cleanup on page unload
//----------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (worker) {
      console.log('Page unloading, terminating worker');
      terminateWorker();
    }
  });
}

//----------------------------------------------------------------------
// Exports
//----------------------------------------------------------------------

export {
  executeInWorker,
  terminateWorker
};