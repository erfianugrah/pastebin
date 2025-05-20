/**
 * Utilities for handling URL-safe encoding of binary data
 * Particularly useful for working with keys in URL fragments
 */

/**
 * Convert a standard Base64 string to URL-safe Base64
 * Replaces characters that are problematic in URLs
 * @param base64 Standard Base64 string
 * @returns URL-safe Base64 string
 */
export function toUrlSafeBase64(base64: string): string {
  // Replace standard Base64 characters with URL-safe ones
  // And remove all padding (not just at the end)
  return base64
    .replace(/\+/g, '-') // Replace + with -
    .replace(/\//g, '_') // Replace / with _
    .replace(/=/g, '');  // Remove all = characters, not just trailing ones
}

/**
 * Convert a URL-safe Base64 string back to standard Base64
 * @param urlSafeBase64 URL-safe Base64 string
 * @returns Standard Base64 string
 */
export function fromUrlSafeBase64(urlSafeBase64: string): string {
  // Replace URL-safe characters with standard Base64 ones
  let base64 = urlSafeBase64
    .replace(/-/g, '+') // Replace - with +
    .replace(/_/g, '/'); // Replace _ with /
    
  // Add padding if needed to make the length a multiple of 4
  // This is required for proper Base64 decoding
  while (base64.length % 4) {
    base64 += '=';
  }
  
  return base64;
}

/**
 * Extract a key from a URL fragment
 * Handles URL-safe Base64 encoding and various formats
 * @param urlFragment URL fragment (after #)
 * @returns Decoded key or null if not found
 */
export function extractKeyFromUrlFragment(urlFragment: string): string | null {
  // Handle empty fragment
  if (!urlFragment) return null;
  
  let key: string | null = null;
  
  try {
    // First check if this is a fragment that doesn't have a key= parameter
    // It must start with key= or contain &key= to be valid
    if (!urlFragment.startsWith('key=') && !urlFragment.includes('&key=')) {
      return null;
    }
    
    // Extract the key with regex to preserve exact encoding
    const directMatch = urlFragment.match(/key=([^&]+)/);
    if (directMatch && directMatch[1]) {
      // Use the raw match to preserve encoding
      key = directMatch[1];
    } else {
      // Try URLSearchParams as fallback
      const hashParams = new URLSearchParams(urlFragment);
      key = hashParams.get('key');
    }
    
    if (key) {
      // Handle percent-encoded characters
      if (key.includes('%')) {
        key = decodeURIComponent(key);
      }
      
      // Convert from URL-safe format to standard Base64
      key = fromUrlSafeBase64(key);
      
      // Remove padding for our test expectations
      key = key.replace(/=+$/, '');
    } else {
      // Empty key value (key=)
      return null;
    }
  } catch (error) {
    console.error('Error extracting key from URL fragment:', error);
    return null;
  }
  
  return key;
}

/**
 * Append an encryption key to a URL as a fragment
 * Uses URL-safe Base64 encoding
 * @param url Base URL without fragment
 * @param key Encryption key (standard Base64)
 * @returns URL with key appended as fragment
 */
export function appendKeyToUrl(url: string, key: string): string {
  if (!key) return url;
  
  // Convert key to URL-safe format
  const urlSafeKey = toUrlSafeBase64(key);
  
  // Remove any existing fragment
  const baseUrl = url.split('#')[0];
  
  // Append the new fragment with the key
  return `${baseUrl}#key=${urlSafeKey}`;
}