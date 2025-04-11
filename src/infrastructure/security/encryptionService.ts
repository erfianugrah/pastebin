/**
 * Server-side encryption service
 * 
 * Note: For client-side encrypted pastes, the server doesn't have
 * the ability to decrypt the content. This service merely recognizes
 * encrypted pastes and marks them accordingly.
 */
export class EncryptionService {
  /**
   * Check if content appears to be encrypted
   * This is a heuristic and not foolproof
   */
  isLikelyEncrypted(content: string): boolean {
    // Client-side encrypted content is base64url encoded and will:
    // 1. Have specific length patterns (multiples of 4 chars)
    // 2. Contain only certain characters
    // 3. Have high entropy
    
    // Basic check for base64url format (no +/ and no padding)
    const base64urlPattern = /^[A-Za-z0-9\-_]+$/;
    if (!base64urlPattern.test(content)) {
      return false;
    }
    
    // Check entropy - encrypted content should have high entropy
    const entropy = this.calculateEntropy(content);
    
    // Typical encrypted content has entropy > 4.5 bits per character
    return entropy > 4.5;
  }
  
  /**
   * Calculate Shannon entropy of a string (bits per character)
   */
  private calculateEntropy(str: string): number {
    const len = str.length;
    
    // Count character frequencies
    const frequencies: Record<string, number> = {};
    for (let i = 0; i < len; i++) {
      const char = str.charAt(i);
      frequencies[char] = (frequencies[char] || 0) + 1;
    }
    
    // Calculate entropy
    return Object.values(frequencies).reduce((entropy, count) => {
      const p = count / len;
      return entropy - (p * Math.log2(p));
    }, 0);
  }
}