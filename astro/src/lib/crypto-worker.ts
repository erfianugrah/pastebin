/**
 * Web Worker for cryptographic operations
 * This worker handles CPU-intensive encryption and decryption tasks
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

// Extract functions from the CommonJS module
const { encodeBase64, decodeBase64: originalDecodeBase64 } = util;

// Constants
const PBKDF2_ITERATIONS = 300000; // High iteration count for better security
const SALT_LENGTH = 16; // 16 bytes salt
const KEY_LENGTH = nacl.secretbox.keyLength; // 32 bytes for NaCl secretbox

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
 * Derive an encryption key from a password using PBKDF2
 */
async function deriveKeyFromPassword(
  password: string, 
  saltBase64?: string
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
    
    // Use PBKDF2 to derive a key
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
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
 */
async function decryptData(
  encryptedBase64: string, 
  keyBase64: string, 
  isPasswordProtected = false
): Promise<string> {
  try {
    // Decode from base64
    const encryptedMessage = decodeBase64(encryptedBase64);
    
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
      const { key: derivedKeyBase64 } = await deriveKeyFromPassword(keyBase64, encodeBase64(salt));
      key = decodeBase64(derivedKeyBase64);
    } else {
      // Direct key decryption
      // Format: [nonce(24) + ciphertext]
      key = decodeBase64(keyBase64);
      nonce = encryptedMessage.slice(0, nacl.secretbox.nonceLength);
      ciphertext = encryptedMessage.slice(nacl.secretbox.nonceLength);
    }
    
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // Decrypt the data
    const decryptedData = nacl.secretbox.open(ciphertext, nonce, key);
    
    if (!decryptedData) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    
    // Convert back to string
    const result = new TextDecoder().decode(decryptedData);
    return result;
  } catch (error) {
    throw error;
  }
}

/**
 * Process data in chunks with progress reporting
 * @param data The data to process
 * @param chunkSize Size of each chunk
 * @param processor Function to process each chunk
 * @param operation The operation being performed
 * @param requestId The request ID for progress reporting
 */
async function processWithProgress<T>(
  data: Uint8Array | string,
  chunkSize: number,
  processor: (chunk: any) => Promise<T>,
  operation: string,
  requestId: string,
  reportProgress: boolean
): Promise<T[]> {
  // Convert string to Uint8Array if needed for consistent handling
  const buffer = typeof data === 'string' 
    ? new TextEncoder().encode(data)
    : data;
  
  const total = buffer.length;
  const numChunks = Math.ceil(total / chunkSize);
  const results: T[] = [];
  let processed = 0;
  
  for (let i = 0; i < numChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, total);
    const chunk = buffer.slice(start, end);
    
    const result = await processor(chunk);
    results.push(result);
    
    processed += (end - start);
    
    // Report progress at regular intervals
    if (reportProgress && (i % 2 === 0 || i === numChunks - 1)) {
      self.postMessage({
        progress: {
          operation,
          total,
          processed,
          requestId
        }
      });
    }
  }
  
  return results;
}

/**
 * Handle messages from the main thread
 */
self.onmessage = async (event: MessageEvent) => {
  try {
    const { operation, params, requestId } = event.data;
    const reportProgress = params.reportProgress || false;
    const chunkSize = params.chunkSize || 1000000; // Default 1MB chunks
    
    let result;
    switch (operation) {
      case 'deriveKey':
        // Key derivation is a single operation, no chunking needed
        result = await deriveKeyFromPassword(params.password, params.salt);
        
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
        // For large data, we need to process in chunks
        if (params.data.length > chunkSize && reportProgress) {
          // Process in chunks for large data
          // This is a simplified approach since we can't actually chunk encryption easily
          // We're just reporting progress as if we were processing chunks
          
          // First, report starting progress
          self.postMessage({
            progress: {
              operation,
              total: params.data.length,
              processed: 0,
              requestId
            }
          });
          
          // Process in simulated chunks
          for (let i = 0; i < params.data.length; i += chunkSize) {
            // Simulate processing time for progress updates
            if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 1));
            }
            
            // Report progress
            self.postMessage({
              progress: {
                operation,
                total: params.data.length,
                processed: Math.min(i + chunkSize, params.data.length),
                requestId
              }
            });
          }
        }
        
        // Actually do the encryption (we can't chunk this easily with the current implementation)
        result = await encryptData(params.data, params.key, params.isPasswordDerived, params.salt);
        break;
        
      case 'decrypt':
        // For large data, report progress 
        if (params.encrypted.length > chunkSize && reportProgress) {
          // Same approach as encryption - simulate progress while doing full operation
          
          // First, report starting progress
          self.postMessage({
            progress: {
              operation,
              total: params.encrypted.length,
              processed: 0,
              requestId
            }
          });
          
          // Process in simulated chunks
          for (let i = 0; i < params.encrypted.length; i += chunkSize) {
            // Simulate processing time for progress updates
            if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 1));
            }
            
            // Report progress
            self.postMessage({
              progress: {
                operation,
                total: params.encrypted.length,
                processed: Math.min(i + chunkSize, params.encrypted.length),
                requestId
              }
            });
          }
        }
        
        // Perform the actual decryption
        result = await decryptData(params.encrypted, params.key, params.isPasswordProtected);
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