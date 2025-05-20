/**
 * Unified Cryptography Module
 * 
 * Provides a consistent interface for all encryption/decryption operations
 * with Web Worker support for improved performance.
 */
import {
  generateEncryptionKey as generateKey,
  deriveKeyFromPassword as deriveKey,
  encryptData as encrypt,
  decryptData as decrypt
} from './core';

import {
  isWebCryptoSupported,
  isWebWorkerSupported,
  detectBrowserCompatibility,
  isLegacyFormat,
  ProgressData,
  WorkerOperation
} from './utils';

// Import test environment polyfill
import { isTestEnvironment, setupTestCryptoPolyfill } from './testPolyfill';

// Set up polyfill for test environments
if (isTestEnvironment()) {
  setupTestCryptoPolyfill();
}

// Log browser compatibility information
const browserCompat = detectBrowserCompatibility();
console.log('Browser compatibility:', browserCompat);

// Web Worker management
type RequestId = string;
let worker: Worker | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;
const WORKER_IDLE_TIMEOUT = 60000; // 60 seconds before terminating idle worker
const pendingRequests = new Map<RequestId, { 
  resolve: (value: any) => void; 
  reject: (reason: any) => void; 
}>();

// Track operation progress
const progressCallbacks = new Map<RequestId, (progress: ProgressData) => void>();

/**
 * Initialize the Web Worker for crypto operations
 */
function initWorker(): Worker {
  if (typeof window === 'undefined') {
    throw new Error('Web Workers can only be used in browser environments');
  }
  
  if (!browserCompat.canUseWorker) {
    throw new Error('Web Workers or Web Crypto API not supported in this browser');
  }
  
  if (!worker) {
    console.log('Creating new Web Worker for crypto operations');
    
    try {
      // Create the worker
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      
      // Handle messages from the worker
      worker.onmessage = (event: MessageEvent) => {
        const { success, result, error, requestId, progress } = event.data;
        
        // Handle progress updates
        if (progress) {
          const progressCallback = progressCallbacks.get(requestId);
          if (progressCallback) {
            progressCallback({ percent: progress.processed });
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
    } catch (error) {
      console.error('Failed to initialize Web Crypto worker:', error);
      throw new Error('Failed to initialize Web Crypto worker');
    }
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
 * Execute a crypto operation in a worker
 */
async function executeInWorker<T>(
  operation: WorkerOperation, 
  params: any, 
  onProgress?: (progress: ProgressData) => void
): Promise<T> {
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
    
    // Add parameters for progress reporting
    const enhancedParams = { 
      ...params, 
      reportProgress: !!onProgress
    };
    
    // Send the message to the worker
    worker.postMessage({ operation, params: enhancedParams, requestId });
    
    // Wait for the worker to respond
    return await promise;
  } catch (error) {
    console.warn('Worker execution failed:', error);
    throw error;
  }
}

/**
 * Generate a random encryption key
 * @returns Base64-encoded encryption key
 */
export function generateEncryptionKey(): string {
  return generateKey();
}

/**
 * Derive an encryption key from a password
 * Uses Web Worker for improved performance when available
 * 
 * @param password The password to derive the key from
 * @param saltBase64 Optional salt (will be randomly generated if not provided)
 * @param progressCallback Optional callback for progress updates
 * @returns Object containing the derived key and salt (both base64 encoded)
 */
export async function deriveKeyFromPassword(
  password: string,
  saltBase64?: string,
  progressCallback?: (progress: ProgressData) => void
): Promise<{ key: string, salt: string }> {
  // Skip worker for server-side rendering
  if (typeof window === 'undefined' || !browserCompat.canUseWorker) {
    return deriveKey(password, saltBase64, false, progressCallback);
  }
  
  const isLargeFile = false; // Default for key derivation
  
  try {
    console.log('Deriving key from password using Web Worker');
    return await executeInWorker<{ key: string, salt: string }>(
      'deriveKey',
      { password, salt: saltBase64, isLargeFile },
      progressCallback
    );
  } catch (error) {
    console.error('Worker-based key derivation failed:', error);
    // Fall back to main thread
    return deriveKey(password, saltBase64, isLargeFile, progressCallback);
  }
}

/**
 * Encrypt data using AES-GCM
 * Uses Web Worker for improved performance with large data
 * 
 * @param data The text to encrypt
 * @param keyBase64 The base64-encoded encryption key or password
 * @param isPasswordProtected Whether to use password-based encryption
 * @param progressCallback Optional callback for progress reporting
 * @returns Base64-encoded encrypted data
 */
export async function encryptData(
  data: string,
  keyBase64: string,
  isPasswordProtected = false,
  saltBase64?: string,
  progressCallback?: (progress: ProgressData) => void,
  useLegacyFormat: boolean = false
): Promise<string> {
  // If caller requested legacy format, use it
  if (useLegacyFormat) {
    console.log('Using legacy encryption format as requested');
    const legacyModule = await import('./legacy');
    return legacyModule.encryptData(
      data,
      keyBase64,
      isPasswordProtected,
      saltBase64,
      progressCallback
    );
  }
  
  // Otherwise use modern WebCrypto implementation
  
  // Skip worker for server-side rendering or small data
  if (typeof window === 'undefined' || !browserCompat.canUseWorker || data.length < 10000) {
    return encrypt(data, keyBase64, isPasswordProtected, progressCallback);
  }
  
  try {
    const isLargeData = data.length >= 100000;
    
    if (isLargeData) {
      console.log(`Encrypting large data (${Math.round(data.length/1024)}KB) using Web Worker with chunking`);
    } else {
      console.log('Encrypting data using Web Worker');
    }
    
    return await executeInWorker<string>(
      'encrypt',
      { 
        data, 
        key: keyBase64, 
        isPasswordProtected 
      },
      progressCallback
    );
  } catch (error) {
    console.error('Worker-based encryption failed:', error);
    // Fall back to main thread
    return encrypt(data, keyBase64, isPasswordProtected, progressCallback);
  }
}

/**
 * Decrypt data encrypted with encryptData
 * Uses Web Worker for improved performance with large data
 * 
 * @param encryptedBase64 The base64-encoded encrypted data
 * @param keyBase64 The base64-encoded key or password
 * @param isPasswordProtected Whether the content was encrypted with a password
 * @param progressCallback Optional callback for progress reporting
 * @returns The decrypted text
 */
export async function decryptData(
  encryptedBase64: string,
  keyBase64: string,
  isPasswordProtected = false,
  progressCallback?: (progress: ProgressData) => void
): Promise<string> {
  try {
    // Check for legacy format
    if (isLegacyFormat(encryptedBase64)) {
      console.log('Detected legacy format - using compatible decryption');
      
      // Dynamically import legacy module to keep it out of the main bundle
      // This means the legacy code is only loaded when needed
      const legacyModule = await import('./legacy');
      return legacyModule.decryptData(
        encryptedBase64,
        keyBase64,
        isPasswordProtected,
        progressCallback
      );
    }
    
    // Use modern implementation for new format
    
    // Skip worker for server-side rendering or small data
    if (typeof window === 'undefined' || !browserCompat.canUseWorker || encryptedBase64.length < 10000) {
      return decrypt(encryptedBase64, keyBase64, isPasswordProtected, progressCallback);
    }
    
    console.log('Decrypting data using Web Worker');
    return await executeInWorker<string>(
      'decrypt',
      { 
        encrypted: encryptedBase64, 
        key: keyBase64, 
        isPasswordProtected 
      },
      progressCallback
    );
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Decryption failed: ' + (error instanceof Error ? error.message : String(error)));
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