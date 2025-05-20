/**
 * Crypto Module Public API
 * =======================
 * 
 * This is the main entry point for the crypto module. It exports a clean public API
 * for cryptographic operations like key derivation, encryption, and decryption.
 * 
 * The module uses Web Workers when available to offload heavy cryptographic operations
 * to a background thread, with automatic fallback to main thread processing when
 * workers are not supported.
 */

import {
  bytesToBase64,
  base64ToBytes,
  randomBytes,
  stringToBytes,
  bytesToString,
  KEY_LENGTH,
  LARGE_FILE_THRESHOLD,
  SALT_LENGTH,
  NONCE_LENGTH,
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_LARGE_FILE,
  combineBytes
} from './utils';

import {
  executeInWorker
} from './worker-manager';

import {
  ProgressCallback,
  ProgressData,
  PublicKeyDerivationResult
} from './types';

import {
  deriveKey,
  encrypt,
  decrypt
} from './core';

//----------------------------------------------------------------------
// Public API Functions
//----------------------------------------------------------------------

/**
 * Generate a new encryption key as a Base64 string
 * @returns Base64-encoded encryption key
 */
export function generateEncryptionKey(): string {
  const key = randomBytes(KEY_LENGTH);
  return bytesToBase64(key);
}

/**
 * Public API: Derive an encryption key from a password 
 * @param password The password to derive the key from
 * @param saltBase64 Optional salt as Base64 string (will be randomly generated if not provided)
 * @param progressCallback Optional callback for progress updates
 * @returns Object containing the derived key and salt (both as Base64 strings)
 */
export async function deriveKeyFromPassword(
  password: string, 
  saltBase64?: string,
  progressCallback?: ProgressCallback
): Promise<PublicKeyDerivationResult> {
  // For server-side rendering, use direct implementation
  if (typeof window === 'undefined') {
    try {
      // Convert Base64 salt to Uint8Array if provided
      const salt = saltBase64 ? base64ToBytes(saltBase64) : undefined;
      
      // Use a lower iteration count for SSR to improve performance
      const isLargeFile = false; // Default for key derivation
      
      // Use proper iteration count based on file size
      const iterations = isLargeFile ? PBKDF2_ITERATIONS_LARGE_FILE : PBKDF2_ITERATIONS;
      
      // Derive the key
      const result = await deriveKey(password, salt, iterations);
      
      // Report initial progress
      if (progressCallback) {
        progressCallback({ percent: 100 });
      }
      
      // Convert result to Base64 for external interfaces
      return {
        key: bytesToBase64(result.key),
        salt: bytesToBase64(result.salt)
      };
    } catch (error) {
      console.error('Key derivation failed in SSR mode:', error);
      throw new Error(`Failed to derive key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Detect if this is for a large file operation
  const isLargeFile = false; // Default for key derivation alone
  
  // Use the worker for client-side rendering
  try {
    console.log('Deriving key from password using Web Worker');
    
    // Convert Base64 salt to Uint8Array if provided
    const salt = saltBase64 ? base64ToBytes(saltBase64) : undefined;
    
    // Wrap the progress callback to report percentage
    const onProgress = progressCallback
      ? (progress: ProgressData) => {
          progressCallback({
            percent: Math.round((progress.processed / progress.total) * 100)
          });
        }
      : undefined;
    
    const result = await executeInWorker<{ key: Uint8Array, salt: Uint8Array }>(
      'deriveKey', 
      { password, salt, isLargeFile },
      onProgress
    );
    
    // Convert result to Base64 for external interfaces
    return {
      key: bytesToBase64(result.key),
      salt: bytesToBase64(result.salt)
    };
  } catch (error) {
    console.error('Key derivation failed:', error);
    throw new Error(`Failed to derive key: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Public API: Encrypt data
 * @param data The text to encrypt
 * @param keyBase64 The Base64-encoded encryption key
 * @param isPasswordDerived Whether this key was derived from a password
 * @param saltBase64 The salt used for password derivation (required if isPasswordDerived is true)
 * @param progressCallback Optional callback for progress updates
 * @returns Base64-encoded encrypted data
 */
export async function encryptData(
  data: string, 
  keyBase64: string, 
  isPasswordDerived = false, 
  saltBase64?: string,
  progressCallback?: ProgressCallback
): Promise<string> {
  // Convert key from Base64 to Uint8Array
  const key = base64ToBytes(keyBase64);
  
  // Convert text to bytes
  const dataBytes = stringToBytes(data);
  
  // Convert salt from Base64 to Uint8Array if provided
  const salt = saltBase64 ? base64ToBytes(saltBase64) : undefined;
  
  // For server-side rendering, use direct implementation
  if (typeof window === 'undefined') {
    try {
      // Report initial progress if callback provided
      if (progressCallback) {
        progressCallback({ percent: 10 });
      }
      
      // Encrypt the data
      const { ciphertext, nonce } = await encrypt(dataBytes, key);
      
      // Report progress after encryption
      if (progressCallback) {
        progressCallback({ percent: 90 });
      }
      
      // Combine the result based on whether password derived
      let result: Uint8Array;
      if (isPasswordDerived && salt) {
        result = combineBytes(salt, nonce, new Uint8Array(ciphertext));
      } else {
        result = combineBytes(nonce, new Uint8Array(ciphertext));
      }
      
      // Final progress update
      if (progressCallback) {
        progressCallback({ percent: 100 });
      }
      
      return bytesToBase64(result);
    } catch (error) {
      console.error('Encryption failed in SSR mode:', error);
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Use the worker for client-side rendering
  try {
    const isLargeData = dataBytes.byteLength >= LARGE_FILE_THRESHOLD;
    
    if (isLargeData) {
      console.log(`Encrypting large data (${Math.round(dataBytes.byteLength/1024)}KB) using Web Worker with progress reporting`);
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
    
    const result = await executeInWorker<Uint8Array>(
      'encrypt', 
      { 
        data: dataBytes, 
        key, 
        isPasswordDerived, 
        salt 
      },
      onProgress
    );
    
    return bytesToBase64(result);
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Public API: Decrypt data
 * @param encryptedBase64 The Base64-encoded encrypted data
 * @param keyBase64 The Base64-encoded encryption key, or password for password-protected content
 * @param isPasswordProtected Whether this content was encrypted with a password
 * @param progressCallback Optional callback for progress updates
 * @returns Decrypted data as string
 */
export async function decryptData(
  encryptedBase64: string, 
  keyBase64: string, 
  isPasswordProtected = false,
  progressCallback?: ProgressCallback
): Promise<string> {
  try {
    // Convert encrypted data from Base64 to bytes
    const encryptedData = base64ToBytes(encryptedBase64);
    
    // For password-protected content, pass the password string directly
    // For key-encrypted content, convert the key from Base64 to bytes
    const key = isPasswordProtected ? keyBase64 : base64ToBytes(keyBase64);
    
    // For server-side rendering, use direct implementation
    if (typeof window === 'undefined') {
      try {
        // Report initial progress
        if (progressCallback) {
          progressCallback({ percent: 10 });
        }
        
        let keyBytes: Uint8Array;
        let nonce: Uint8Array;
        let ciphertext: Uint8Array;
        
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
            progressCallback({ percent: 20 });
          }
          
          // Derive key from password using the extracted salt
          const isLargeFile = encryptedData.byteLength > LARGE_FILE_THRESHOLD;
          const iterations = isLargeFile ? PBKDF2_ITERATIONS_LARGE_FILE : PBKDF2_ITERATIONS;
          const { key: derivedKey } = await deriveKey(password, salt, iterations);
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
            progressCallback({ percent: 40 });
          }
        }
        
        // Report progress before decryption
        if (progressCallback) {
          progressCallback({ percent: 60 });
        }
        
        // Decrypt the data
        const decrypted = await decrypt(ciphertext, nonce, keyBytes);
        
        if (!decrypted) {
          throw new Error('Decryption failed - invalid key or corrupted data');
        }
        
        // Final progress report
        if (progressCallback) {
          progressCallback({ percent: 100 });
        }
        
        return bytesToString(decrypted);
      } catch (error) {
        console.error('Decryption failed in SSR mode:', error);
        throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Use the worker for client-side rendering
    try {
      const isLargeData = encryptedData.byteLength >= LARGE_FILE_THRESHOLD;
      
      if (isLargeData) {
        console.log(`Decrypting large data (${Math.round(encryptedData.byteLength/1024)}KB) using Web Worker with chunked processing`);
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
      
      const result = await executeInWorker<Uint8Array>(
        'decrypt', 
        { 
          encrypted: encryptedData, 
          key, 
          isPasswordProtected 
        },
        onProgress
      );
      
      return bytesToString(result);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

//----------------------------------------------------------------------
// Additional Exports from Utils
//----------------------------------------------------------------------

// Re-export utility functions that might be useful to consumers
export {
  bytesToBase64,
  base64ToBytes,
  stringToBytes,
  bytesToString
} from './utils';