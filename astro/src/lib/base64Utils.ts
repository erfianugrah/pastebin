/**
 * Optimized Base64 utility functions using Web APIs
 * Highly efficient and reliable implementation for binary data
 */

/**
 * Encode a Uint8Array to a Base64 string
 * Uses the most efficient method available in current environment
 * @param data The Uint8Array to encode
 * @returns Base64 encoded string
 */
export function encodeBase64(data: Uint8Array): string {
  // Use the most efficient implementation based on environment
  if (typeof Buffer !== 'undefined') {
    // Node.js environment
    return Buffer.from(data).toString('base64');
  } else if (typeof btoa === 'function') {
    try {
      // Browser environment - convert to binary string first
      // Using Uint8Array.prototype.reduce is more efficient for large arrays
      let binaryString = '';
      for (let i = 0; i < data.length; i++) {
        binaryString += String.fromCharCode(data[i]);
      }
      
      // Native btoa function for best performance
      return btoa(binaryString);
    } catch (error) {
      console.warn('Standard Base64 encoding failed, using fallback method');
      return encodeBase64Fallback(data);
    }
  } else {
    // Environment without built-in methods
    return encodeBase64Fallback(data);
  }
}

/**
 * Fallback Base64 encoding implementation
 * @param data The Uint8Array to encode
 * @returns Base64 encoded string
 */
function encodeBase64Fallback(data: Uint8Array): string {
  const lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const output = [];
  
  // Process every 3 bytes of input (24 bits -> 4 Base64 chars)
  for (let i = 0; i < data.length; i += 3) {
    // Combine 3 bytes into a single 24-bit integer
    const triplet = (data[i] << 16) | 
                   ((i + 1 < data.length) ? data[i + 1] << 8 : 0) | 
                   ((i + 2 < data.length) ? data[i + 2] : 0);
    
    // Extract 4 groups of 6 bits each and convert to base64 chars
    output.push(
      lookup[(triplet >> 18) & 0x3F],
      lookup[(triplet >> 12) & 0x3F],
      (i + 1 < data.length) ? lookup[(triplet >> 6) & 0x3F] : '=',
      (i + 2 < data.length) ? lookup[triplet & 0x3F] : '='
    );
  }
  
  return output.join('');
}

/**
 * Decode a Base64 string to a Uint8Array
 * Uses the most efficient method available in current environment
 * @param base64String The Base64 string to decode
 * @returns Uint8Array of decoded bytes
 */
export function decodeBase64(base64String: string): Uint8Array {
  try {
    // Normalize the base64 string first (handle URL-safe variants and padding)
    let normalizedBase64 = base64String
      .replace(/-/g, '+') // Convert URL-safe characters
      .replace(/_/g, '/');
    
    // Add padding if needed
    while (normalizedBase64.length % 4 !== 0) {
      normalizedBase64 += '=';
    }
    
    // Use most efficient implementation based on environment
    if (typeof Buffer !== 'undefined') {
      // Node.js environment
      return new Uint8Array(Buffer.from(normalizedBase64, 'base64'));
    } else if (typeof atob === 'function') {
      // Browser environment - use native atob
      const binaryString = atob(normalizedBase64);
      
      // Pre-allocate the result for better performance
      const result = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        result[i] = binaryString.charCodeAt(i);
      }
      return result;
    } else {
      // Environment without built-in methods
      return decodeBase64Fallback(normalizedBase64);
    }
  } catch (error) {
    // Handle specific errors for better debugging
    if (error instanceof Error) {
      if (error.name === 'InvalidCharacterError') {
        throw new Error('Invalid Base64 encoding: contains invalid characters');
      } else {
        console.warn('Standard Base64 decoding failed, trying fallback', error);
        return decodeBase64Fallback(base64String);
      }
    }
    throw error;
  }
}

/**
 * Fallback Base64 decoding implementation
 * @param base64String The Base64 string to decode
 * @returns Uint8Array of decoded bytes
 */
function decodeBase64Fallback(base64String: string): Uint8Array {
  try {
    // Remove any invalid characters and normalize
    const cleanInput = base64String.replace(/[^A-Za-z0-9+/=]/g, '');
    
    // Add padding
    const paddedInput = cleanInput + '==='.slice(0, (4 - cleanInput.length % 4) % 4);
    
    // Create lookup map for faster character conversion
    const lookup: Record<string, number> = {};
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < chars.length; i++) {
      lookup[chars.charAt(i)] = i;
    }
    
    // Calculate the exact output length for performance
    const outputLength = Math.floor((paddedInput.length / 4) * 3);
    const result = new Uint8Array(outputLength);
    
    let outputPosition = 0;
    
    // Process 4 Base64 characters at a time (24 bits -> 3 bytes)
    for (let i = 0; i < paddedInput.length; i += 4) {
      // Get the numeric values of the four Base64 characters
      const values = [
        lookup[paddedInput.charAt(i)] || 0,
        lookup[paddedInput.charAt(i + 1)] || 0,
        lookup[paddedInput.charAt(i + 2)] || 0,
        lookup[paddedInput.charAt(i + 3)] || 0
      ];
      
      // Combine the 4 6-bit values into 3 bytes (24 bits)
      const bytes = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
      
      // Extract the 3 bytes and add to result
      if (outputPosition < outputLength) 
        result[outputPosition++] = (bytes >> 16) & 0xFF;
      
      if (paddedInput.charAt(i + 2) !== '=' && outputPosition < outputLength) 
        result[outputPosition++] = (bytes >> 8) & 0xFF;
      
      if (paddedInput.charAt(i + 3) !== '=' && outputPosition < outputLength) 
        result[outputPosition++] = bytes & 0xFF;
    }
    
    // Return result sliced to the correct length (in case of padding)
    return result.slice(0, outputPosition);
  } catch (error) {
    console.error('All Base64 decoding methods failed:', error);
    throw new Error('Unable to decode corrupted Base64 data. The data may be invalid or corrupted.');
  }
}

/**
 * Safely decode a Base64 string, fixing common issues with padding and invalid characters
 * Tries multiple strategies to handle problematic Base64 strings
 * @param input The Base64 string to decode
 * @returns Uint8Array of decoded bytes
 */
export function safeDecodeBase64(input: string): Uint8Array {
  try {
    // Try standard decoding first
    return decodeBase64(input);
  } catch (error) {
    console.warn('Standard Base64 decoding failed, attempting recovery', error);
    
    try {
      // Apply most common Base64 fixes
      // 1. Handle URL-safe variants (replace - and _ with + and /)
      let fixedInput = input.replace(/-/g, '+').replace(/_/g, '/');
      
      // 2. Fix padding
      while (fixedInput.length % 4) {
        fixedInput += '=';
      }
      
      // 3. Try decoding with fixed input
      return decodeBase64(fixedInput);
    } catch (paddingError) {
      console.warn('Padding fix failed, attempting aggressive recovery');
      
      try {
        // 4. More aggressive cleaning - Remove all non-Base64 characters
        let sanitizedInput = input.replace(/[^A-Za-z0-9+/=\-_]/g, '');
        
        // 5. Convert URL-safe characters
        sanitizedInput = sanitizedInput.replace(/-/g, '+').replace(/_/g, '/');
        
        // 6. Fix padding
        while (sanitizedInput.length % 4) {
          sanitizedInput += '=';
        }
        
        // Try with sanitized input
        return decodeBase64(sanitizedInput);
      } catch (sanitizeError) {
        console.warn('Sanitization failed, falling back to minimal validation method');
        
        // Last resort - Fall back to minimal validation method
        return decodeBase64Fallback(input);
      }
    }
  }
}