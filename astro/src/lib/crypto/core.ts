/**
 * Core cryptography operations using Web Crypto API
 */
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  PBKDF2_ITERATIONS,
  PBKDF2_ITERATIONS_LARGE_FILE,
  SALT_LENGTH,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  LARGE_FILE_THRESHOLD,
  CHUNK_SIZE,
  FORMAT_VERSION,
  isWebCryptoSupported,
  ProgressData
} from './utils';

/**
 * Generate a random encryption key
 * @returns Base64-encoded encryption key
 */
export function generateEncryptionKey(): string {
  if (!isWebCryptoSupported()) {
    throw new Error('Web Crypto API is not supported in this environment');
  }
  
  // Generate a 256-bit (32 byte) random key
  const key = crypto.getRandomValues(new Uint8Array(32));
  return arrayBufferToBase64(key);
}

/**
 * Import a raw key (from base64) for use with Web Crypto API
 * @param keyBase64 Base64-encoded key
 * @returns Imported CryptoKey
 */
export async function importKey(keyBase64: string): Promise<CryptoKey> {
  if (!isWebCryptoSupported()) {
    throw new Error('Web Crypto API is not supported in this environment');
  }
  
  const keyData = base64ToArrayBuffer(keyBase64);
  
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false, // not extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive an encryption key from a password using PBKDF2
 * @param password The password to derive the key from
 * @param saltBase64 Optional salt (will be randomly generated if not provided)
 * @param isLargeFile Whether to use lower iteration count for large files
 * @param progressCallback Optional callback for progress updates
 * @returns Object containing the derived key and salt (both base64 encoded)
 */
export async function deriveKeyFromPassword(
  password: string,
  saltBase64?: string,
  isLargeFile: boolean = false,
  progressCallback?: (progress: ProgressData) => void
): Promise<{ key: string, salt: string }> {
  if (!isWebCryptoSupported()) {
    throw new Error('Web Crypto API is not supported in this environment');
  }
  
  try {
    // Report initial progress
    if (progressCallback) {
      progressCallback({ percent: 0 });
    }
    
    // Generate salt if not provided
    const salt = saltBase64
      ? base64ToArrayBuffer(saltBase64)
      : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    
    // Convert password to a format usable by Web Crypto API
    const passwordBuffer = new TextEncoder().encode(password);
    
    // Import the password as a key
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    if (progressCallback) {
      progressCallback({ percent: 20 });
    }
    
    // Use adaptive iteration count based on file size for performance
    const iterations = isLargeFile ? PBKDF2_ITERATIONS_LARGE_FILE : PBKDF2_ITERATIONS;
    
    // Use PBKDF2 to derive a key
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt instanceof Uint8Array ? salt : new Uint8Array(salt),
        iterations: iterations,
        hash: 'SHA-256'
      },
      passwordKey,
      256 // 256 bits (32 bytes)
    );
    
    if (progressCallback) {
      progressCallback({ percent: 90 });
    }
    
    // Convert to Base64 for storage
    const keyBase64 = arrayBufferToBase64(derivedBits);
    const saltBase64Output = arrayBufferToBase64(salt instanceof Uint8Array ? salt : new Uint8Array(salt));
    
    if (progressCallback) {
      progressCallback({ percent: 100 });
    }
    
    return {
      key: keyBase64,
      salt: saltBase64Output
    };
  } catch (error) {
    console.error('Key derivation error:', error);
    throw new Error('Failed to derive key from password: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Encrypt data using AES-GCM with chunked processing for large files
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
  progressCallback?: (progress: ProgressData) => void
): Promise<string> {
  if (!isWebCryptoSupported()) {
    throw new Error('Web Crypto API is not supported in this environment');
  }
  
  try {
    // Report initial progress
    if (progressCallback) {
      progressCallback({ percent: 0 });
    }

    // Step 1: Prepare the key
    let cryptoKey: CryptoKey;
    let salt: Uint8Array | undefined;
    
    if (isPasswordProtected) {
      // For password-protected content, derive a key using PBKDF2
      salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const { key } = await deriveKeyFromPassword(
        keyBase64, // password
        arrayBufferToBase64(salt),
        data.length > LARGE_FILE_THRESHOLD,
        progressCallback ? 
          (progress) => progressCallback({ percent: progress.percent * 0.4 }) : // 40% for key derivation
          undefined
      );
      
      // Import the derived key
      cryptoKey = await importKey(key);
    } else {
      // Direct key usage (not password derived)
      cryptoKey = await importKey(keyBase64);
      
      if (progressCallback) {
        progressCallback({ percent: 40 }); // Skip the key derivation progress portion
      }
    }
    
    // Step 2: Convert data to ArrayBuffer
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(data);
    
    if (progressCallback) {
      progressCallback({ percent: 50 });
    }
    
    // Step 3: Generate IV (initialization vector)
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    
    // Step 4: Encrypt the data
    if (dataBytes.length <= CHUNK_SIZE) {
      // Small data: encrypt all at once
      const encryptedBuffer = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          tagLength: AUTH_TAG_LENGTH * 8
        },
        cryptoKey,
        dataBytes
      );
      
      if (progressCallback) {
        progressCallback({ percent: 90 });
      }
      
      // Step 5: Combine format version, IV, optional salt, and encrypted data
      const versionByte = new Uint8Array([FORMAT_VERSION]);
      let resultBuffer: Uint8Array;
      
      if (isPasswordProtected && salt) {
        // Format: [Version (1)] + [IV (12)] + [Salt (16)] + [Ciphertext]
        resultBuffer = new Uint8Array(1 + IV_LENGTH + SALT_LENGTH + encryptedBuffer.byteLength);
        resultBuffer.set(versionByte, 0);
        resultBuffer.set(iv, 1);
        resultBuffer.set(salt, 1 + IV_LENGTH);
        resultBuffer.set(new Uint8Array(encryptedBuffer), 1 + IV_LENGTH + SALT_LENGTH);
      } else {
        // Format: [Version (1)] + [IV (12)] + [Ciphertext]
        resultBuffer = new Uint8Array(1 + IV_LENGTH + encryptedBuffer.byteLength);
        resultBuffer.set(versionByte, 0);
        resultBuffer.set(iv, 1);
        resultBuffer.set(new Uint8Array(encryptedBuffer), 1 + IV_LENGTH);
      }
      
      if (progressCallback) {
        progressCallback({ percent: 100 });
      }
      
      return arrayBufferToBase64(resultBuffer);
    } else {
      // Large data: encrypt in chunks
      const numChunks = Math.ceil(dataBytes.length / CHUNK_SIZE);
      const totalSize = isPasswordProtected && salt 
        ? 1 + IV_LENGTH + SALT_LENGTH + (dataBytes.length + (numChunks * AUTH_TAG_LENGTH))
        : 1 + IV_LENGTH + (dataBytes.length + (numChunks * AUTH_TAG_LENGTH));
      
      const resultBuffer = new Uint8Array(totalSize);
      
      // Set format version, IV, and salt
      resultBuffer[0] = FORMAT_VERSION;
      resultBuffer.set(iv, 1);
      
      let offset = 1 + IV_LENGTH;
      if (isPasswordProtected && salt) {
        resultBuffer.set(salt, offset);
        offset += SALT_LENGTH;
      }
      
      // Process each chunk
      for (let i = 0; i < numChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, dataBytes.length);
        const chunk = dataBytes.slice(start, end);
        
        // Create a unique IV for each chunk by incrementing last 4 bytes
        const chunkIv = iv.slice();
        const counter = new DataView(new ArrayBuffer(4));
        counter.setUint32(0, i, false); // Big-endian counter
        const counterArray = new Uint8Array(counter.buffer);
        
        // Mix the counter into the IV (last 4 bytes)
        for (let j = 0; j < 4; j++) {
          chunkIv[IV_LENGTH - 4 + j] ^= counterArray[j];
        }
        
        // Encrypt the chunk
        const encryptedChunk = await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: chunkIv,
            tagLength: AUTH_TAG_LENGTH * 8
          },
          cryptoKey,
          chunk
        );
        
        // Copy encrypted chunk to result buffer
        resultBuffer.set(new Uint8Array(encryptedChunk), offset);
        offset += encryptedChunk.byteLength;
        
        if (progressCallback) {
          const percent = 50 + (40 * (i + 1) / numChunks); // 50-90% for encryption
          progressCallback({ percent: Math.round(percent) });
        }
        
        // Allow browser to render between chunks
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      if (progressCallback) {
        progressCallback({ percent: 100 });
      }
      
      return arrayBufferToBase64(resultBuffer.slice(0, offset));
    }
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Encryption failed: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Decrypt data encrypted with encryptData
 * Uses chunked processing for large files
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
  if (!isWebCryptoSupported()) {
    throw new Error('Web Crypto API is not supported in this environment');
  }
  
  try {
    // Report initial progress
    if (progressCallback) {
      progressCallback({ percent: 0 });
    }
    
    // Step 1: Convert from Base64 to ArrayBuffer
    const encryptedBytes = base64ToArrayBuffer(encryptedBase64);
    const isLargeFile = encryptedBytes.byteLength > LARGE_FILE_THRESHOLD;
    
    if (progressCallback) {
      progressCallback({ percent: 10 });
    }
    
    // Step 2: Parse the encrypted data format
    // First byte is format version
    const formatVersion = encryptedBytes[0];
    if (formatVersion !== FORMAT_VERSION) {
      throw new Error(`Unsupported encryption format version: ${formatVersion}`);
    }
    
    // Next 12 bytes are IV
    const iv = encryptedBytes.slice(1, 1 + IV_LENGTH);
    
    let dataStartIndex = 1 + IV_LENGTH;
    let salt: Uint8Array | undefined;
    
    if (isPasswordProtected) {
      // Extract salt (16 bytes)
      salt = encryptedBytes.slice(dataStartIndex, dataStartIndex + SALT_LENGTH);
      dataStartIndex += SALT_LENGTH;
    }
    
    // Step 3: Prepare the key
    let cryptoKey: CryptoKey;
    
    if (isPasswordProtected && salt) {
      // For password-protected content, derive the key using PBKDF2
      const { key } = await deriveKeyFromPassword(
        keyBase64, // password
        arrayBufferToBase64(salt),
        isLargeFile,
        progressCallback ? 
          (progress) => progressCallback({ percent: 10 + (progress.percent * 0.3) }) : // 10-40% for key derivation
          undefined
      );
      
      // Import the derived key
      cryptoKey = await importKey(key);
    } else {
      // Direct key usage
      cryptoKey = await importKey(keyBase64);
      
      if (progressCallback) {
        progressCallback({ percent: 40 }); // Skip the key derivation progress portion
      }
    }
    
    // Step 4: Decrypt the data
    const encryptedData = encryptedBytes.slice(dataStartIndex);
    
    if (encryptedData.byteLength <= CHUNK_SIZE + AUTH_TAG_LENGTH) {
      // Small data: decrypt all at once
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          tagLength: AUTH_TAG_LENGTH * 8
        },
        cryptoKey,
        encryptedData
      );
      
      if (progressCallback) {
        progressCallback({ percent: 90 });
      }
      
      // Convert ArrayBuffer to string
      const decoder = new TextDecoder();
      const result = decoder.decode(decryptedBuffer);
      
      if (progressCallback) {
        progressCallback({ percent: 100 });
      }
      
      return result;
    } else {
      // For large files, we need to decrypt in chunks
      // This is tricky because GCM doesn't have a fixed ciphertext expansion per chunk
      // For simplicity, we'll assume a fixed chunk size pattern
      
      // Rough estimate of how many chunks we have
      const estimatedChunks = Math.ceil(encryptedData.byteLength / (CHUNK_SIZE + AUTH_TAG_LENGTH));
      let decryptedResult = '';
      
      // Process chunks based on original chunk size + auth tag
      const chunkSizeWithTag = CHUNK_SIZE + AUTH_TAG_LENGTH;
      
      for (let i = 0; i < estimatedChunks; i++) {
        const start = i * chunkSizeWithTag;
        const end = Math.min(start + chunkSizeWithTag, encryptedData.byteLength);
        const encryptedChunk = encryptedData.slice(start, end);
        
        // Create unique IV for this chunk by incrementing last 4 bytes
        const chunkIv = new Uint8Array(iv);
        const counter = new DataView(new ArrayBuffer(4));
        counter.setUint32(0, i, false); // Big-endian counter
        const counterArray = new Uint8Array(counter.buffer);
        
        // Mix the counter into the IV (last 4 bytes)
        for (let j = 0; j < 4; j++) {
          chunkIv[IV_LENGTH - 4 + j] ^= counterArray[j];
        }
        
        try {
          // Decrypt the chunk
          const decryptedChunk = await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: chunkIv,
              tagLength: AUTH_TAG_LENGTH * 8
            },
            cryptoKey,
            encryptedChunk
          );
          
          // Decode and append to result
          const decoder = new TextDecoder();
          decryptedResult += decoder.decode(decryptedChunk, { stream: i < estimatedChunks - 1 });
          
          if (progressCallback) {
            const percent = 40 + (50 * (i + 1) / estimatedChunks); // 40-90% for decryption
            progressCallback({ percent: Math.round(percent) });
          }
          
          // Allow browser to render between chunks
          await new Promise(resolve => setTimeout(resolve, 0));
        } catch (error) {
          console.error(`Error decrypting chunk ${i}:`, error);
          throw new Error(`Failed to decrypt chunk ${i}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      if (progressCallback) {
        progressCallback({ percent: 100 });
      }
      
      return decryptedResult;
    }
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Decryption failed: ' + (error instanceof Error ? error.message : String(error)));
  }
}