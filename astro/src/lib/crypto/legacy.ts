/**
 * Legacy cryptography implementation for backward compatibility
 * Uses TweetNaCl.js to handle existing encrypted content
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { ProgressData } from './utils';

// Extract functions from the CommonJS module
const { encodeBase64, decodeBase64: originalDecodeBase64 } = util;

// Constants
const SALT_LENGTH = 16; // 16 bytes salt
const KEY_LENGTH = nacl.secretbox.keyLength; // 32 bytes for NaCl secretbox
const LARGE_FILE_THRESHOLD = 1000000; // 1MB threshold
const CHUNK_SIZE = 1024 * 1024; // 1MB chunk size for processing

/**
 * Safe decodeBase64 function that handles invalid inputs
 */
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
 * Generate a random encryption key
 * @returns Base64-encoded encryption key
 */
export function generateEncryptionKey(): string {
  const key = nacl.randomBytes(KEY_LENGTH);
  return encodeBase64(key);
}

/**
 * Derive an encryption key from a password
 * @param password The password to derive key from
 * @param saltBase64 Optional salt (will be randomly generated if not provided)
 * @param progressCallback Optional callback for progress updates
 * @returns Object containing the derived key and salt (both base64 encoded)
 */
export async function deriveKeyFromPassword(
  password: string,
  saltBase64?: string,
  progressCallback?: (progress: ProgressData) => void
): Promise<{ key: string, salt: string }> {
  if (progressCallback) {
    progressCallback({ percent: 0 });
  }
  
  try {
    // Generate salt if not provided
    const salt = saltBase64 
      ? decodeBase64(saltBase64)
      : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    
    if (progressCallback) {
      progressCallback({ percent: 20 });
    }
    
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
    
    if (progressCallback) {
      progressCallback({ percent: 50 });
    }
    
    // Use PBKDF2 to derive a key
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 300000,
        hash: 'SHA-256'
      },
      passwordKey,
      KEY_LENGTH * 8 // Key length in bits (32 bytes * 8)
    );
    
    // Convert the derived bits to a Uint8Array for TweetNaCl
    const derivedKey = new Uint8Array(derivedBits);
    
    if (progressCallback) {
      progressCallback({ percent: 100 });
    }
    
    return {
      key: encodeBase64(derivedKey),
      salt: encodeBase64(salt)
    };
  } catch (error) {
    console.error('Legacy key derivation error:', error);
    throw new Error('Failed to derive key from password: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Encrypt data using NaCl secretbox (XSalsa20-Poly1305)
 * @param data The text to encrypt
 * @param keyBase64 The base64-encoded encryption key
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
  progressCallback?: (progress: ProgressData) => void
): Promise<string> {
  if (progressCallback) {
    progressCallback({ percent: 0 });
  }
  
  try {
    // Decode the key from base64
    const key = decodeBase64(keyBase64);
    
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // Convert content to Uint8Array
    const messageUint8 = new TextEncoder().encode(data);
    
    if (progressCallback) {
      progressCallback({ percent: 30 });
    }
    
    // Create nonce (unique value for each encryption)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    
    // Encrypt the data
    const encryptedData = nacl.secretbox(messageUint8, nonce, key);
    
    if (progressCallback) {
      progressCallback({ percent: 80 });
    }
    
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
    const result = encodeBase64(finalEncryptedMessage);
    
    if (progressCallback) {
      progressCallback({ percent: 100 });
    }
    
    return result;
  } catch (error) {
    console.error('Legacy encryption error:', error);
    throw error;
  }
}

/**
 * Decrypt data that was encrypted with legacy secretbox encryption
 * @param encryptedBase64 The base64-encoded encrypted data
 * @param keyBase64 The base64-encoded encryption key, or password
 * @param isPasswordProtected Whether this content was encrypted with a password
 * @param progressCallback Optional callback for progress updates
 * @returns Decrypted data as string
 */
export async function decryptData(
  encryptedBase64: string,
  keyBase64: string,
  isPasswordProtected = false,
  progressCallback?: (progress: ProgressData) => void
): Promise<string> {
  if (progressCallback) {
    progressCallback({ percent: 0 });
  }
  
  try {
    // Step 1: Decode from Base64
    const encryptedMessage = decodeBase64(encryptedBase64);
    
    if (progressCallback) {
      progressCallback({ percent: 20 });
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
      const { key: derivedKeyBase64 } = await deriveKeyFromPassword(
        keyBase64,
        encodeBase64(salt),
        progressCallback ? 
          (progress) => { 
            // Map 0-100 to 20-60 (key derivation is ~40% of the work)
            const percent = 20 + (progress.percent * 0.4);
            progressCallback({ percent });
          } : undefined
      );
      
      key = decodeBase64(derivedKeyBase64);
    } else {
      // Direct key decryption
      // Format: [nonce(24) + ciphertext]
      key = decodeBase64(keyBase64);
      nonce = encryptedMessage.slice(0, nacl.secretbox.nonceLength);
      ciphertext = encryptedMessage.slice(nacl.secretbox.nonceLength);
      
      if (progressCallback) {
        progressCallback({ percent: 60 }); // Skip the key derivation progress portion
      }
    }
    
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // Decrypt the data
    const decryptedData = nacl.secretbox.open(ciphertext, nonce, key);
    
    if (!decryptedData) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    
    if (progressCallback) {
      progressCallback({ percent: 80 });
    }
    
    // Convert back to string
    const result = new TextDecoder().decode(decryptedData);
    
    if (progressCallback) {
      progressCallback({ percent: 100 });
    }
    
    return result;
  } catch (error) {
    console.error('Legacy decryption error:', error);
    throw error;
  }
}