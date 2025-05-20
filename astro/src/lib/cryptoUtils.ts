/**
 * Crypto Utilities - Legacy Compatibility
 * =====================================
 * 
 * This file serves as a compatibility layer for older code that
 * might still import from '../lib/cryptoUtils'.
 * It re-exports the utility functions from the new modular crypto implementation.
 */

// Re-export the utility functions from the new crypto module
export {
  KEY_LENGTH,
  NONCE_LENGTH,
  SALT_LENGTH,
  AUTH_TAG_LENGTH,
  randomBytes,
  stringToBytes,
  bytesToString,
  bytesToBase64,
  base64ToBytes,
  combineBytes
} from './crypto/utils';

// Re-export core functions
export {
  encrypt,
  decrypt,
  deriveKey,
  generateKey
} from './crypto/core';