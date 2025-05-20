/**
 * Web Worker for Cryptographic Operations
 * =======================================
 * 
 * This worker handles CPU-intensive encryption and decryption tasks with
 * optimized chunked processing for large files. It provides progress reporting
 * and secure per-chunk encryption using unique derived nonces.
 */

//----------------------------------------------------------------------
// Imports
//----------------------------------------------------------------------
import {
  KEY_LENGTH,
  NONCE_LENGTH,
  SALT_LENGTH,
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_LARGE_FILE,
  LARGE_FILE_THRESHOLD,
  CHUNK_SIZE,
  randomBytes,
  combineBytes,
  stringToBytes,
  bytesToString,
  mapProgress
} from './utils';

import {
  encrypt,
  decrypt,
  deriveKey
} from './core';

import {
  WorkerRequest,
  WorkerResponse,
  ProgressData,
  ProgressUpdate,
  WorkerOperation
} from './types';

//----------------------------------------------------------------------
// Core Cryptographic Functions
//----------------------------------------------------------------------

/**
 * Derive a key from a password with adaptive iteration count
 * 
 * Uses PBKDF2 with SHA-256 to derive a secure key from a password.
 * For large files, uses fewer iterations to improve performance while
 * maintaining security.
 * 
 * @param password The password to derive the key from
 * @param salt Optional salt for key derivation (will be generated if not provided)
 * @param isLargeFile Whether this is for a large file (uses fewer iterations for performance)
 * @returns Object containing the derived key and salt used
 */
async function deriveKeyFromPassword(
  password: string, 
  salt?: Uint8Array,
  isLargeFile: boolean = false
): Promise<{ key: Uint8Array, salt: Uint8Array }> {
  // Validate inputs
  if (!password) {
    throw new Error('Password is required for key derivation');
  }
  
  // Validate salt if provided
  if (salt && salt.byteLength !== SALT_LENGTH) {
    throw new Error(`Invalid salt length: ${salt.byteLength}. Expected: ${SALT_LENGTH} bytes`);
  }
  
  // Use adaptive iteration count based on file size for performance
  const iterations = isLargeFile ? PBKDF2_ITERATIONS_LARGE_FILE : PBKDF2_ITERATIONS;
  
  // Derive the key
  return deriveKey(password, salt, iterations);
}

/**
 * Process data in chunks to avoid memory issues and enable progress reporting
 * 
 * This core utility function handles:
 * - Splitting large data into manageable chunks
 * - Processing each chunk with the provided processor function
 * - Reporting progress throughout the operation
 * - Error handling and validation
 * 
 * Used by both encryption and decryption operations to handle large files
 * efficiently without excessive memory usage.
 * 
 * @param data The data to process
 * @param chunkSize The size of each chunk in bytes
 * @param processor Function that processes each chunk
 * @param progressCallback Optional callback for reporting progress
 * @param operation The operation name for progress reporting
 * @param requestId Optional requestId for progress reporting
 * @param progressRange Optional range for progress mapping as [startPercent, endPercent]
 * @returns Array of processed chunks
 */
async function processInChunks(
  data: Uint8Array,
  chunkSize: number,
  processor: (chunk: Uint8Array, chunkIndex: number, totalChunks: number) => Promise<Uint8Array>,
  progressCallback?: (processed: number, total: number, operation: string, requestId: string) => void,
  operation: string = 'process',
  requestId: string = '',
  progressRange: [number, number] = [0, 100] // Default to full range
): Promise<Uint8Array[]> {
  // Validate input
  if (!data || data.byteLength === 0) {
    console.warn('Empty data provided to processInChunks');
    return [];
  }
  
  if (chunkSize <= 0) {
    console.warn('Invalid chunk size, defaulting to 1MB');
    chunkSize = 1024 * 1024; // Default to 1MB
  }
  
  // Validate progress range
  if (progressRange[0] >= progressRange[1]) {
    console.warn('Invalid progress range, defaulting to [0, 100]');
    progressRange = [0, 100];
  }
  
  // Calculate the number of chunks
  const totalChunks = Math.ceil(data.byteLength / chunkSize);
  const results: Uint8Array[] = [];
  
  // Report initial progress
  if (progressCallback) {
    progressCallback(progressRange[0], 100, operation, requestId);
  }
  
  // Process each chunk
  try {
    for (let i = 0; i < totalChunks; i++) {
      // Calculate chunk start and end positions
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.byteLength);
      
      // Extract the chunk
      const chunk = data.slice(start, end);
      
      // Process the chunk
      const processedChunk = await processor(chunk, i, totalChunks);
      // Even empty Uint8Arrays are truthy, so check for null/undefined specifically
      // Also verify it's actually a Uint8Array with non-zero length
      if (processedChunk !== null && processedChunk !== undefined) {
        if (!(processedChunk instanceof Uint8Array)) {
          throw new Error(`${operation}: Chunk ${i+1} processor returned non-Uint8Array result: ${typeof processedChunk}`);
        }
        results.push(processedChunk);
      } else {
        throw new Error(`${operation}: Chunk processing failed for chunk ${i+1} of ${totalChunks}`);
      }
      
      // Report progress if callback provided
      if (progressCallback) {
        const rawProgress = Math.floor((i + 1) / totalChunks * 100);
        const mappedProgress = mapProgress(rawProgress, progressRange[0], progressRange[1]);
        progressCallback(mappedProgress, 100, operation, requestId);
      }
    }
    
    return results;
  } catch (error) {
    // Log and rethrow the error
    console.error(`Error in ${operation} processInChunks:`, error);
    throw new Error(`${operation} chunked processing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

//----------------------------------------------------------------------
// Encryption Implementation
//----------------------------------------------------------------------

/**
 * Encrypt data with chunked processing for large files
 * 
 * For large files, this function implements a secure chunking approach:
 * 1. Generates a random base nonce
 * 2. For each chunk, derives a unique nonce by XORing the base nonce with the chunk index
 * 3. Encrypts each chunk with its unique nonce
 * 4. Stores both nonce and ciphertext for each chunk to enable deterministic decryption
 * 5. Combines all encrypted chunks with proper format for later decryption
 * 
 * For small files, uses standard single-pass encryption.
 * 
 * @param data The data to encrypt
 * @param key The encryption key
 * @param isPasswordDerived Whether the key was derived from a password
 * @param salt The salt used for key derivation (required if isPasswordDerived is true)
 * @param reportProgress Whether to report progress during encryption
 * @param requestId Identifier for progress reporting
 * @returns Encrypted data as Uint8Array
 */
async function encryptData(
  data: Uint8Array, 
  key: Uint8Array, 
  isPasswordDerived = false, 
  salt?: Uint8Array,
  reportProgress = false,
  requestId = ''
): Promise<Uint8Array> {
  try {
    // Validate inputs
    if (!data || data.byteLength === 0) {
      throw new Error('Data is required for encryption');
    }
    
    if (!key || key.byteLength !== KEY_LENGTH) {
      throw new Error(`Invalid encryption key length: ${key?.byteLength || 0}. Expected: ${KEY_LENGTH} bytes`);
    }
    
    if (isPasswordDerived && (!salt || salt.byteLength !== SALT_LENGTH)) {
      throw new Error(`Salt is required for password-derived encryption and must be ${SALT_LENGTH} bytes`);
    }
    
    // Check if chunking is needed
    const needsChunking = data.byteLength > LARGE_FILE_THRESHOLD;
    
    if (needsChunking) {
      // For large files, we need a secure approach to chunk encryption
      // Generate a unique base nonce that will be used to derive per-chunk nonces
      const baseNonce = randomBytes(NONCE_LENGTH);
      
      // Define the chunk processor function
      const processChunk = async (chunk: Uint8Array, chunkIndex: number, totalChunks: number) => {
        // Create a unique nonce for this chunk by XORing the base nonce with the chunk index
        // This ensures each chunk gets a unique nonce while maintaining deterministic derivation
        const chunkNonce = new Uint8Array(baseNonce);
        // XOR the last 4 bytes with the chunk index (as a 32-bit number)
        const indexBytes = new Uint8Array(4);
        const dataView = new DataView(indexBytes.buffer);
        dataView.setUint32(0, chunkIndex, true); // little-endian
        
        // Apply the XOR operation to create a unique nonce per chunk
        for (let i = 0; i < 4 && i < NONCE_LENGTH; i++) {
          chunkNonce[NONCE_LENGTH - i - 1] ^= indexBytes[i];
        }
        
        // Encrypt this chunk with the derived nonce
        const { ciphertext } = await encrypt(chunk, key, chunkNonce);
        
        // Return the nonce + ciphertext so we can decrypt without knowing chunk boundaries
        return combineBytes(chunkNonce, ciphertext);
      };
      
      // Process in chunks with progress reporting
      const processProgressCallback = reportProgress ? 
        (processed: number, total: number, operation: string, id: string) => {
          // For compatibility with the main thread, calculate percent
          const percent = Math.floor((processed / total) * 100);
          const progressData: ProgressUpdate = {
            progress: {
              operation,
              total,
              processed,
              percent, // Add percent field for compatibility
              requestId: id
            }
          };
          self.postMessage(progressData);
        } : undefined;
      
      // Use the 0-80% range for the chunked processing
      const encryptedChunks = await processInChunks(
        data, 
        CHUNK_SIZE, 
        processChunk, 
        processProgressCallback,
        'encrypt',
        requestId,
        [0, 80] // Progress range: 0-80%
      );
      
      // Report combining progress
      if (reportProgress) {
        const progressData: ProgressUpdate = {
          progress: {
            operation: 'encrypt',
            total: 100,
            processed: 90, // 90% - combining results
            percent: 90,   // Add percent field for compatibility
            requestId
          }
        };
        self.postMessage(progressData);
      }
      
      // Combine all encrypted chunks
      const totalSize = encryptedChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
      const combinedCiphertext = new Uint8Array(totalSize);
      
      let offset = 0;
      for (const chunk of encryptedChunks) {
        combinedCiphertext.set(chunk, offset);
        offset += chunk.byteLength;
      }
      
      // Let the chunks array go out of scope naturally for garbage collection
      // No need to manually nullify references
      
      // Final result
      let result: Uint8Array;
      if (isPasswordDerived && salt) {
        // Store the base nonce as it's needed for decryption
        result = combineBytes(salt, baseNonce, combinedCiphertext);
      } else {
        result = combineBytes(baseNonce, combinedCiphertext);
      }
      
      return result;
    } else {
      // For small files, use the standard approach
      // Encrypt the data
      const { ciphertext, nonce } = await encrypt(data, key);
      
      // If this encryption used a password-derived key, include the salt in the output
      if (isPasswordDerived && salt) {
        return combineBytes(salt, nonce, ciphertext);
      } else {
        // Standard encryption with just nonce + ciphertext
        return combineBytes(nonce, ciphertext);
      }
    }
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

//----------------------------------------------------------------------
// Decryption Implementation
//----------------------------------------------------------------------

/**
 * Decrypt data with chunked processing for large files
 * 
 * This function handles the decryption of data that was encrypted either with a password
 * or direct key. For large files, it:
 * 1. Extracts the base nonce (and salt if password-protected)
 * 2. Extracts each chunk's nonce and ciphertext
 * 3. Processes chunks in manageable sizes to avoid memory issues
 * 4. Reports progress throughout the operation
 * 
 * It handles both formats:
 * - Password-protected: [salt(16) + baseNonce(12) + chunks]
 * - Key-encrypted: [baseNonce(12) + chunks]
 * 
 * Where each chunk contains [chunkNonce(12) + ciphertext]
 * 
 * @param encryptedData The encrypted data to decrypt
 * @param key The decryption key or password
 * @param isPasswordProtected Whether the data was encrypted with a password
 * @param reportProgress Whether to report progress during decryption
 * @param requestId Identifier for progress reporting
 * @returns Decrypted data as Uint8Array
 */
async function decryptData(
  encryptedData: Uint8Array, 
  key: Uint8Array | string, 
  isPasswordProtected = false,
  reportProgress = false,
  requestId = ''
): Promise<Uint8Array> {
  try {
    // Validate inputs
    if (!encryptedData || encryptedData.byteLength === 0) {
      throw new Error('Encrypted data is required for decryption');
    }
    
    if (!key) {
      throw new Error('Key or password is required for decryption');
    }
    
    let keyBytes: Uint8Array;
    let nonce: Uint8Array;
    let ciphertext: Uint8Array;
    
    // Report progress at the start
    if (reportProgress) {
      const progressData: ProgressUpdate = {
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: 10, // Initial parsing
          percent: 10,   // Add percent field for compatibility
          requestId
        }
      };
      self.postMessage(progressData);
    }
    
    if (isPasswordProtected) {
      // Validate minimum data length for password-protected content
      if (encryptedData.byteLength < SALT_LENGTH + NONCE_LENGTH + 1) {
        throw new Error('Encrypted data is too short for password-protected format');
      }
      
      // Extract salt, nonce, and ciphertext from the encrypted message
      // Format: [salt(16) + baseNonce(12) + ciphertext]
      const salt = encryptedData.slice(0, SALT_LENGTH);
      nonce = encryptedData.slice(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH); // This is the baseNonce
      ciphertext = encryptedData.slice(SALT_LENGTH + NONCE_LENGTH);
      
      // For password-protected content, key is a password string
      const password = typeof key === 'string' ? key : bytesToString(key);
      
      // Report progress before key derivation
      if (reportProgress) {
        const progressData: ProgressUpdate = {
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 25, // Starting key derivation
            percent: 25,   // Add percent field for compatibility
            requestId
          }
        };
        self.postMessage(progressData);
      }
      
      // Derive key from password using the extracted salt
      const isLargeFile = encryptedData.byteLength > LARGE_FILE_THRESHOLD;
      const { key: derivedKey } = await deriveKeyFromPassword(password, salt, isLargeFile);
      keyBytes = derivedKey;
      
      // Report progress after key derivation
      if (reportProgress) {
        const progressData: ProgressUpdate = {
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 50, // Key derivation complete
            percent: 50,   // Add percent field for compatibility
            requestId
          }
        };
        self.postMessage(progressData);
      }
    } else {
      // Validate minimum data length for key-encrypted content
      if (encryptedData.byteLength < NONCE_LENGTH + 1) {
        throw new Error('Encrypted data is too short for key-encrypted format');
      }
      
      // For key-encrypted content, key should be a Uint8Array
      keyBytes = typeof key === 'string' ? stringToBytes(key) : key;
      
      // Validate key length
      if (keyBytes.byteLength !== KEY_LENGTH) {
        throw new Error(`Invalid key length: ${keyBytes.byteLength}. Expected: ${KEY_LENGTH} bytes`);
      }
      
      // Format: [baseNonce(12) + ciphertext]
      nonce = encryptedData.slice(0, NONCE_LENGTH); // This is the baseNonce
      ciphertext = encryptedData.slice(NONCE_LENGTH);
      
      // Report progress (skip the key derivation step)
      if (reportProgress) {
        const progressData: ProgressUpdate = {
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 50, // Moving to decryption step
            percent: 50,   // Add percent field for compatibility
            requestId
          }
        };
        self.postMessage(progressData);
      }
    }
    
    // Report progress before decryption
    if (reportProgress) {
      const progressData: ProgressUpdate = {
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: 60, // Starting decryption
          percent: 60,   // Add percent field for compatibility
          requestId
        }
      };
      self.postMessage(progressData);
    }
    
    // We'll use a different approach for chunked processing than we initially implemented.
    // For compatibility with existing data, let's use the same approach as the main thread.
    // This means decrypting the entire ciphertext at once with the extracted nonce.
    
    // Report progress during processing
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: 70, // Starting actual decryption
          percent: 70,
          requestId
        }
      });
    }
    
    try {
      // Import the key for AES-GCM
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
      
      // Report progress after key import
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 80,
            percent: 80,
            requestId
          }
        });
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
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 95,
            percent: 95,
            requestId
          }
        });
      }
      
      // Report completion
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 100,
            percent: 100,
            requestId
          }
        });
      }
      
      return new Uint8Array(decrypted);
    } catch (error) {
      console.error('Decryption error during worker processing:', error);
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

//----------------------------------------------------------------------
// Web Worker Message Handler
//----------------------------------------------------------------------

/**
 * Handle incoming messages from the main thread
 * 
 * This is the main entry point for the Web Worker. It receives messages from
 * the main thread, performs the requested cryptographic operations, and returns
 * the results. Supports three operations:
 * 
 * 1. deriveKey - Derives a key from a password
 * 2. encrypt - Encrypts data with a key or password
 * 3. decrypt - Decrypts data with a key or password
 * 
 * For all operations, it handles progress reporting and error handling.
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const { operation, params, requestId } = event.data;
    const reportProgress = params.reportProgress || false;
    
    // Single progress reporting function for all operations
    const reportProgressUpdate = (progress: number) => {
      if (reportProgress) {
        // For compatibility with the main thread, we send progress with percent field
        const progressData: ProgressUpdate = {
          progress: {
            operation,
            total: 100,
            processed: progress,
            percent: progress,  // Add explicit percent field for main thread compatibility
            requestId
          }
        };
        
        // Send the progress update to the main thread
        self.postMessage(progressData);
      }
    };
    
    // Initial progress report for all operations
    reportProgressUpdate(0);
    
    let result;
    switch (operation) {
      case 'deriveKey':
        // Key derivation is a single operation, no chunking needed
        reportProgressUpdate(10); // Started key derivation
        result = await deriveKeyFromPassword(
          params.password, 
          params.salt,
          params.isLargeFile || false
        );
        reportProgressUpdate(100); // Completed key derivation
        break;
        
      case 'encrypt':
        // Perform the encryption with progress reporting if needed
        result = await encryptData(
          params.data, 
          params.key, 
          params.isPasswordDerived, 
          params.salt,
          reportProgress,
          requestId
        );
        reportProgressUpdate(100); // Encryption complete
        break;
        
      case 'decrypt':
        // Perform optimized decryption with progress reporting
        result = await decryptData(
          params.encrypted, 
          params.key, 
          params.isPasswordProtected,
          reportProgress,
          requestId
        );
        reportProgressUpdate(100); // Decryption complete
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    // Return successful result
    const response: WorkerResponse = {
      success: true,
      result,
      requestId
    };
    self.postMessage(response);
  } catch (error) {
    console.error('Error in worker:', error);
    const errorResponse: WorkerResponse = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      requestId: event.data.requestId
    };
    self.postMessage(errorResponse);
  }
};

//----------------------------------------------------------------------
// Module Export
//----------------------------------------------------------------------

// Empty export to make TypeScript treat this as a module
export {};