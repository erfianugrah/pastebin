/**
 * "Secure" storage helper that encrypts values before writing them into
 * browser storage. Used by CodeViewer to cache per-paste decryption keys
 * so a returning user doesn't have to re-enter the password.
 *
 * ## Threat model — read this before assuming anything
 *
 * What this DOES protect against:
 *   - A passive observer with file-system access to the browser profile
 *     (e.g., raw localStorage scrape on a stolen laptop): values are
 *     ciphertext under a randomly-generated master key.
 *   - Casual DOM inspection: values look opaque.
 *
 * What this does NOT protect against:
 *   - **XSS.** Any script that runs on the page can read the master key
 *     (it's in sessionStorage) and decrypt every cached value in the
 *     same call. Encryption here adds zero defense against script
 *     injection. This is the primary threat for a pastebin.
 *   - **Browser extensions** with localStorage / sessionStorage read
 *     permission: same as XSS.
 *   - **Compromised supabase server-side**: not relevant — pasted
 *     content is E2EE before upload; the server never sees plaintext.
 *
 * ## Key location
 *
 * The master key lives in **sessionStorage**, not localStorage. This
 * reduces the persistence window: closing the tab clears the master key,
 * which makes already-encrypted cached items unrecoverable (we
 * intentionally re-prompt the user rather than re-derive). On the same
 * page session the key is reused so cached items decrypt correctly.
 *
 * Prior versions stored the master key in localStorage, giving it the
 * same lifetime as the values it protected. That co-location made the
 * encryption purely cosmetic against any attacker who could read storage
 * at all. The sessionStorage move shortens the window without changing
 * the underlying primitive — the XSS caveat still applies.
 */

import { encryptData, decryptData, generateEncryptionKey } from './crypto';

const STORAGE_PREFIX = '__secure_pasteriser_';
const MASTER_KEY_NAME = `${STORAGE_PREFIX}mk`;

/**
 * Gets or creates a master encryption key. Key is kept in sessionStorage
 * (per-tab, cleared on close). Values stay in localStorage so they survive
 * across sessions, but become irrecoverable once the master key is gone —
 * that's the intended behaviour: re-prompt rather than persist key forever.
 */
async function getMasterKey(): Promise<string> {
  try {
    let masterKey = sessionStorage.getItem(MASTER_KEY_NAME);

    if (!masterKey) {
      masterKey = generateEncryptionKey();
      sessionStorage.setItem(MASTER_KEY_NAME, masterKey);

      // Migrate any legacy localStorage-resident key into sessionStorage so
      // existing users don't lose their cache on this upgrade. The old key
      // is wiped from localStorage after migration.
      const legacy = localStorage.getItem(MASTER_KEY_NAME);
      if (legacy) {
        sessionStorage.setItem(MASTER_KEY_NAME, legacy);
        masterKey = legacy;
        localStorage.removeItem(MASTER_KEY_NAME);
      }

      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        console.log('Generated new secure storage master key (sessionStorage)');
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