/**
 * Secure storage utility that encrypts sensitive data before storing in localStorage
 * Uses the Web Crypto API for encryption
 */

import { encryptData, decryptData, generateEncryptionKey } from './crypto';

const STORAGE_PREFIX = '__secure_pasterisr_';
const MASTER_KEY_NAME = `${STORAGE_PREFIX}mk`;

/**
 * Gets or creates a master encryption key for localStorage encryption
 */
async function getMasterKey(): Promise<string> {
  try {
    let masterKey = localStorage.getItem(MASTER_KEY_NAME);
    
    if (!masterKey) {
      // Generate a new master key
      masterKey = generateEncryptionKey();
      localStorage.setItem(MASTER_KEY_NAME, masterKey);
      
      // Only log in development
      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        console.log('Generated new secure storage master key');
      }
    }
    
    return masterKey;
  } catch (error) {
    console.error('Failed to get/create master key for secure storage');
    throw error;
  }
}

/**
 * Securely stores a value in localStorage with encryption
 */
export async function secureStore(key: string, value: string): Promise<void> {
  try {
    const masterKey = await getMasterKey();
    const encryptedValue = await encryptData(value, masterKey);
    
    const secureKey = `${STORAGE_PREFIX}${key}`;
    localStorage.setItem(secureKey, encryptedValue);
  } catch (error) {
    console.error('Failed to securely store data:', error);
    throw new Error('Failed to store data securely');
  }
}

/**
 * Retrieves and decrypts a value from localStorage
 */
export async function secureRetrieve(key: string): Promise<string | null> {
  try {
    const secureKey = `${STORAGE_PREFIX}${key}`;
    const encryptedValue = localStorage.getItem(secureKey);
    
    if (!encryptedValue) {
      return null;
    }
    
    const masterKey = await getMasterKey();
    const decryptedValue = await decryptData(encryptedValue, masterKey);
    
    return decryptedValue;
  } catch (error) {
    // If decryption fails, the data might be corrupted - remove it
    console.warn('Failed to decrypt stored data, removing:', error);
    secureRemove(key);
    return null;
  }
}

/**
 * Removes a securely stored item
 */
export function secureRemove(key: string): void {
  const secureKey = `${STORAGE_PREFIX}${key}`;
  localStorage.removeItem(secureKey);
}

/**
 * Checks if a securely stored item exists
 */
export function secureHas(key: string): boolean {
  const secureKey = `${STORAGE_PREFIX}${key}`;
  return localStorage.getItem(secureKey) !== null;
}

/**
 * Clears all securely stored data and regenerates master key
 */
export function secureClear(): void {
  const keys = Object.keys(localStorage).filter(key => key.startsWith(STORAGE_PREFIX));
  keys.forEach(key => localStorage.removeItem(key));
  
  // Only log in development
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    console.log('Cleared all secure storage data');
  }
}

/**
 * Migrates existing plaintext localStorage entries to secure storage
 */
export async function migrateToSecureStorage(keysToMigrate: string[]): Promise<void> {
  try {
    for (const key of keysToMigrate) {
      const plainValue = localStorage.getItem(key);
      if (plainValue && !key.startsWith(STORAGE_PREFIX)) {
        await secureStore(key, plainValue);
        localStorage.removeItem(key); // Remove the plaintext version
        
        // Only log in development
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
          console.log(`Migrated ${key} to secure storage`);
        }
      }
    }
  } catch (error) {
    console.error('Failed to migrate to secure storage:', error);
  }
}