/**
 * Client-side encryption utilities for pastes using TweetNaCl.js
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

// Extract functions from the CommonJS module
const { encodeBase64, decodeBase64 } = util;

/**
 * Generate a random encryption key
 * @returns Base64-encoded encryption key
 */
export function generateEncryptionKey(): string {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  return encodeBase64(key);
}

/**
 * Encrypt data using NaCl secretbox (XSalsa20-Poly1305)
 * @param data The text to encrypt
 * @param keyBase64 The base64-encoded encryption key
 * @returns Base64-encoded encrypted data (nonce + ciphertext)
 */
export async function encryptData(data: string, keyBase64: string): Promise<string> {
  console.log('Encrypting data of length:', data.length);
  console.log('Using key:', keyBase64.substring(0, 5) + '...');
  
  try {
    // Decode the key from base64
    const key = decodeBase64(keyBase64);
    console.log('Decoded key length:', key.length);
    
    if (key.length !== nacl.secretbox.keyLength) {
      console.error(`Invalid key length: ${key.length}, expected: ${nacl.secretbox.keyLength}`);
      throw new Error(`Invalid key length: ${key.length}, expected: ${nacl.secretbox.keyLength}`);
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
    
    // Combine nonce and encrypted data
    const encryptedMessage = new Uint8Array(nonce.length + encryptedData.length);
    encryptedMessage.set(nonce);
    encryptedMessage.set(encryptedData, nonce.length);
    console.log('Combined message length:', encryptedMessage.length);
    
    // Encode for storage and transport
    const result = encodeBase64(encryptedMessage);
    console.log('Base64 result length:', result.length);
    
    return result;
  } catch (error) {
    console.error('Encryption error:', error);
    throw error;
  }
}

/**
 * Decrypt data that was encrypted with encryptData
 * @param encryptedBase64 The base64-encoded encrypted data
 * @param keyBase64 The base64-encoded encryption key
 * @returns Decrypted data as string
 */
export async function decryptData(encryptedBase64: string, keyBase64: string): Promise<string> {
  console.log('Decrypting data of length:', encryptedBase64.length);
  console.log('Using key:', keyBase64.substring(0, 5) + '...');
  
  try {
    // Decode from base64
    const encryptedMessage = decodeBase64(encryptedBase64);
    console.log('Decoded message length:', encryptedMessage.length);
    
    const key = decodeBase64(keyBase64);
    console.log('Decoded key length:', key.length);
    
    if (key.length !== nacl.secretbox.keyLength) {
      console.error(`Invalid key length: ${key.length}, expected: ${nacl.secretbox.keyLength}`);
      throw new Error(`Invalid key length: ${key.length}, expected: ${nacl.secretbox.keyLength}`);
    }
    
    // Extract nonce from the beginning of the message
    const nonce = encryptedMessage.slice(0, nacl.secretbox.nonceLength);
    console.log('Extracted nonce length:', nonce.length);
    
    const ciphertext = encryptedMessage.slice(nacl.secretbox.nonceLength);
    console.log('Extracted ciphertext length:', ciphertext.length);
    
    // Decrypt the data
    const decryptedData = nacl.secretbox.open(ciphertext, nonce, key);
    
    if (!decryptedData) {
      console.error('Decryption failed - invalid key or corrupted data');
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    
    console.log('Decrypted data length:', decryptedData.length);
    
    // Convert back to string
    const result = new TextDecoder().decode(decryptedData);
    console.log('Decrypted string length:', result.length);
    console.log('First 50 chars of decrypted data:', result.substring(0, 50));
    
    return result;
  } catch (error) {
    console.error('Decryption error:', error);
    throw error;
  }
}

/**
 * Derive an encryption key from a password
 * Note: This implements PBKDF2-like functionality using TweetNaCl
 * 
 * @param password The password to derive the key from
 * @param saltBase64 Optional salt (will be randomly generated if not provided)
 * @returns Object containing the derived key and salt (both base64 encoded)
 */
export async function deriveKeyFromPassword(
  password: string, 
  saltBase64?: string
): Promise<{ key: string, salt: string }> {
  // Generate salt if not provided
  const salt = saltBase64 
    ? decodeBase64(saltBase64)
    : nacl.randomBytes(16);
  
  // Convert password to Uint8Array
  const passwordBytes = new TextEncoder().encode(password);
  
  // Combine password and salt
  const combined = new Uint8Array(passwordBytes.length + salt.length);
  combined.set(passwordBytes);
  combined.set(salt, passwordBytes.length);
  
  // Use TweetNaCl's hash function (SHA-512) 
  // Apply multiple iterations to increase security
  let result = combined;
  for (let i = 0; i < 10000; i++) {
    result = nacl.hash(result);
  }
  
  // Use the first 32 bytes as the key
  const derivedKey = result.slice(0, 32);
  
  return {
    key: encodeBase64(derivedKey),
    salt: encodeBase64(salt)
  };
}