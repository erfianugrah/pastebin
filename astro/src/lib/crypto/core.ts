/**
 * Core Cryptographic Primitives
 * ============================
 * 
 * This file contains low-level cryptographic operations using the Web Crypto API.
 * These functions provide the foundation for the higher-level encryption/decryption
 * operations used by the application.
 */

import {
  KEY_LENGTH,
  SALT_LENGTH,
  NONCE_LENGTH,
  AUTH_TAG_LENGTH,
  PBKDF2_ITERATIONS,
  randomBytes,
  combineBytes
} from './utils';

//----------------------------------------------------------------------
// Core Cryptographic Constants
//----------------------------------------------------------------------

// Algorithm definitions
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_DERIVATION_ALGORITHM = 'PBKDF2';
const KEY_IMPORT_ALGORITHM = 'AES-GCM';

//----------------------------------------------------------------------
// Core Cryptographic Operations
//----------------------------------------------------------------------

/**
 * Import a raw key for AES-GCM encryption/decryption
 * @param keyData The raw key data as Uint8Array
 * @returns A CryptoKey that can be used for encryption/decryption
 */
export async function importKey(keyData: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: KEY_IMPORT_ALGORITHM },
    false, // Not extractable
    ['encrypt', 'decrypt'] // Can be used for both encryption and decryption
  );
}

/**
 * Generate a random encryption key
 * @returns Encryption key as Uint8Array
 */
export function generateKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

/**
 * Encrypt data using AES-GCM
 * @param data The data to encrypt as Uint8Array
 * @param key The encryption key as Uint8Array
 * @param nonce Optional nonce as Uint8Array (will be generated if not provided)
 * @returns An object containing the encrypted data and nonce
 */
export async function encrypt(
  data: Uint8Array,
  key: Uint8Array,
  nonce?: Uint8Array
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  // Generate a random nonce if not provided
  const nonceToUse = nonce || randomBytes(NONCE_LENGTH);
  
  // Import the key for AES-GCM
  const cryptoKey = await importKey(key);
  
  // Encrypt the data
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ENCRYPTION_ALGORITHM,
      iv: nonceToUse, // Initialization vector (nonce)
      tagLength: AUTH_TAG_LENGTH * 8 // Tag length in bits
    },
    cryptoKey,
    data
  );
  
  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce: nonceToUse
  };
}

/**
 * Decrypt data using AES-GCM
 * @param ciphertext The encrypted data as Uint8Array
 * @param nonce The nonce used for encryption as Uint8Array
 * @param key The encryption key as Uint8Array
 * @returns The decrypted data as Uint8Array, or null if decryption fails
 */
export async function decrypt(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array | null> {
  try {
    // Import the key for AES-GCM
    const cryptoKey = await importKey(key);
    
    // Decrypt the data
    const decrypted = await crypto.subtle.decrypt(
      {
        name: ENCRYPTION_ALGORITHM,
        iv: nonce,
        tagLength: AUTH_TAG_LENGTH * 8
      },
      cryptoKey,
      ciphertext
    );
    
    return new Uint8Array(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}

/**
 * Derive a key from a password using PBKDF2
 * @param password The password as string
 * @param salt The salt as Uint8Array (will be generated if not provided)
 * @param iterations The number of iterations to use (higher is more secure but slower)
 * @returns An object containing the derived key and salt
 */
export async function deriveKey(
  password: string,
  salt?: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS
): Promise<{ key: Uint8Array, salt: Uint8Array }> {
  // Generate salt if not provided
  const saltToUse = salt || randomBytes(SALT_LENGTH);
  
  // Convert password to a format usable by Web Crypto API
  const passwordBuffer = new TextEncoder().encode(password);
  
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
      salt: saltToUse,
      iterations: iterations,
      hash: 'SHA-256'
    },
    passwordKey,
    KEY_LENGTH * 8 // Key length in bits
  );
  
  return {
    key: new Uint8Array(derivedBits),
    salt: saltToUse
  };
}