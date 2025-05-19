/**
 * Web Worker for cryptographic operations
 * This worker handles CPU-intensive encryption and decryption tasks
 * Optimized for chunked processing of large files
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

// Extract functions from the CommonJS module
const { encodeBase64, decodeBase64: originalDecodeBase64 } = util;

// Constants
const PBKDF2_ITERATIONS = 300000; // High iteration count for better security
const PBKDF2_ITERATIONS_LARGE_FILE = 100000; // Lower for large files to improve performance
const LARGE_FILE_THRESHOLD = 1000000; // 1MB
const SALT_LENGTH = 16; // 16 bytes salt
const KEY_LENGTH = nacl.secretbox.keyLength; // 32 bytes for NaCl secretbox
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

/**
 * Incrementally decode Base64 string in chunks
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
    
    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  // Return the actual data (might be slightly smaller than allocated due to padding)
  return result.slice(0, resultOffset);
}

/**
 * Derive an encryption key from a password using PBKDF2
 * Now with adaptive iteration count based on file size
 */
async function deriveKeyFromPassword(
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
    throw new Error('Failed to derive key from password: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Encrypt data using NaCl secretbox
 */
async function encryptData(
  data: string, 
  keyBase64: string, 
  isPasswordDerived = false, 
  saltBase64?: string
): Promise<string> {
  try {
    // Decode the key from base64
    const key = decodeBase64(keyBase64);
    
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // Convert content to Uint8Array
    const messageUint8 = new TextEncoder().encode(data);
    
    // Create nonce (unique value for each encryption)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    
    // Encrypt the data
    const encryptedData = nacl.secretbox(messageUint8, nonce, key);
    
    // If this encryption used a password-derived key, include the salt in the output
    let finalEncryptedMessage: Uint8Array;
    if (isPasswordDerived && saltBase64) {
      const salt = decodeBase64(saltBase64);
      finalEncryptedMessage = new Uint8Array(salt.length + nonce.length + encryptedData.length);
      finalEncryptedMessage.set(salt); // First 16 bytes: salt
      finalEncryptedMessage.set(nonce, salt.length); // Next 24 bytes: nonce
      finalEncryptedMessage.set(encryptedData, salt.length + nonce.length); // Remainder: ciphertext
    } else {
      // Standard encryption with just nonce + ciphertext
      finalEncryptedMessage = new Uint8Array(nonce.length + encryptedData.length);
      finalEncryptedMessage.set(nonce); // First 24 bytes: nonce
      finalEncryptedMessage.set(encryptedData, nonce.length); // Remainder: ciphertext
    }
    
    // Encode for storage and transport
    return encodeBase64(finalEncryptedMessage);
  } catch (error) {
    throw error;
  }
}

/**
 * Decrypt data that was encrypted with encryptData
 * Optimized for large files with chunked processing
 */
async function decryptData(
  encryptedBase64: string, 
  keyBase64: string, 
  isPasswordProtected = false,
  reportProgress = false,
  requestId = ''
): Promise<string> {
  try {
    const isLargeFile = encryptedBase64.length > LARGE_FILE_THRESHOLD;
    
    // Decode from base64 using incremental decoding for large files
    const encryptedMessage = isLargeFile 
      ? await incrementalBase64Decode(
          encryptedBase64,
          CHUNK_SIZE,
          reportProgress ? (processed, total) => {
            self.postMessage({
              progress: {
                operation: 'decrypt',
                total: total,
                processed: processed,
                requestId
              }
            });
          } : undefined
        )
      : decodeBase64(encryptedBase64);
    
    // Report progress after base64 decoding complete
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: 50, // Base64 decoding complete - 50% of the way there
          requestId
        }
      });
    }
    
    let key: Uint8Array;
    let nonce: Uint8Array;
    let ciphertext: Uint8Array;
    
    if (isPasswordProtected) {
      // Extract salt, nonce, and ciphertext from the encrypted message
      // Format: [salt(16) + nonce(24) + ciphertext]
      const salt = encryptedMessage.slice(0, SALT_LENGTH);
      nonce = encryptedMessage.slice(SALT_LENGTH, SALT_LENGTH + nacl.secretbox.nonceLength);
      ciphertext = encryptedMessage.slice(SALT_LENGTH + nacl.secretbox.nonceLength);
      
      // Derive key from password using the extracted salt
      // Use the adaptive iteration count for large files
      const { key: derivedKeyBase64 } = await deriveKeyFromPassword(keyBase64, encodeBase64(salt), isLargeFile);
      key = decodeBase64(derivedKeyBase64);
      
      // Report progress after key derivation (which is CPU-intensive)
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 75, // Key derivation complete
            requestId
          }
        });
      }
    } else {
      // Direct key decryption
      // Format: [nonce(24) + ciphertext]
      key = decodeBase64(keyBase64);
      nonce = encryptedMessage.slice(0, nacl.secretbox.nonceLength);
      ciphertext = encryptedMessage.slice(nacl.secretbox.nonceLength);
      
      // Report progress (skip the key derivation step)
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 75, // Moving to decryption step
            requestId
          }
        });
      }
    }
    
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // Decrypt the data - unfortunately nacl.secretbox.open doesn't support streaming
    // so we have to process the entire ciphertext at once
    const decryptedData = nacl.secretbox.open(ciphertext, nonce, key);
    
    if (!decryptedData) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    
    // Report progress before text decoding
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: 90, // Decryption complete, converting to string
          requestId
        }
      });
    }
    
    // Convert back to string in chunks for large data
    let result = '';
    if (decryptedData.length > CHUNK_SIZE) {
      const decoder = new TextDecoder();
      const chunks = Math.ceil(decryptedData.length / CHUNK_SIZE);
      
      for (let i = 0; i < chunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, decryptedData.length);
        const chunk = decryptedData.slice(start, end);
        
        result += decoder.decode(chunk, { stream: i < chunks - 1 });
        
        // Report progress during string conversion
        if (reportProgress) {
          const percent = 90 + (i / chunks) * 10; // 90-100%
          self.postMessage({
            progress: {
              operation: 'decrypt',
              total: 100,
              processed: Math.round(percent),
              requestId
            }
          });
        }
        
        // Allow UI to update
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } else {
      // For smaller data, decode all at once
      result = new TextDecoder().decode(decryptedData);
    }
    
    // Final progress update
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: 100, // Complete
          requestId
        }
      });
    }
    
    return result;
  } catch (error) {
    throw error;
  }
}

/**
 * Handle messages from the main thread
 */
self.onmessage = async (event: MessageEvent) => {
  try {
    const { operation, params, requestId } = event.data;
    const reportProgress = params.reportProgress || false;
    
    let result;
    switch (operation) {
      case 'deriveKey':
        // Key derivation is a single operation, no chunking needed
        result = await deriveKeyFromPassword(
          params.password, 
          params.salt,
          params.isLargeFile || false
        );
        
        // Report completion progress
        if (reportProgress) {
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: 100,
              requestId
            }
          });
        }
        break;
        
      case 'encrypt':
        // For large data, we report progress during encryption
        if (params.data.length > LARGE_FILE_THRESHOLD && reportProgress) {
          // First, report starting progress
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: 0,
              requestId
            }
          });
          
          // Update for string encoding step
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: 20,
              requestId
            }
          });
        }
        
        // Perform the actual encryption
        result = await encryptData(
          params.data, 
          params.key, 
          params.isPasswordDerived, 
          params.salt
        );
        
        // Final progress update
        if (reportProgress) {
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: 100,
              requestId
            }
          });
        }
        break;
        
      case 'decrypt':
        // Perform optimized chunked decryption with progress reporting
        result = await decryptData(
          params.encrypted, 
          params.key, 
          params.isPasswordProtected,
          reportProgress,
          requestId
        );
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    self.postMessage({ 
      success: true, 
      result, 
      requestId
    });
  } catch (error) {
    self.postMessage({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error), 
      requestId: event.data.requestId 
    });
  }
};

export {}; // Required to make TypeScript treat this as a module