# End-to-End Encryption in Pasteriser

This document explains how the encryption works in Pasteriser, our secure pastebin service. We use client-side encryption to ensure that sensitive content is never seen by the server in plain text form.

## Overview

Pasteriser implements true end-to-end encryption (E2EE), meaning that all encryption and decryption happens in the user's browser, not on the server. This provides strong privacy guarantees:

1. The server never sees the unencrypted content
2. The server never receives the encryption password or key
3. Only users with the correct password or full URL (containing the key) can decrypt the content

## Security Features

### Encryption Method

We use the following encryption standards:

- **Symmetric Encryption**: XSalsa20-Poly1305 via TweetNaCl.js (`nacl.secretbox`)
- **Key Derivation**: PBKDF2 via Web Crypto API with 300,000 iterations for password-based encryption
- **Random Generation**: Cryptographically secure random number generation for keys, nonces, and salts

### Two Security Options

When creating a paste, users can choose between two security methods:

1. **Password Protection (E2EE)**:
   - A user-supplied password is used to derive an encryption key via PBKDF2
   - A unique random salt is generated for each paste
   - The content is encrypted with the derived key
   - The encrypted content includes the salt so it can be decrypted later
   - The server never receives the password

2. **Key Protection (E2EE)**:
   - A random 32-byte encryption key is generated
   - The content is encrypted with this key
   - The key is appended to the URL fragment (after the # symbol)
   - URL fragments are never sent to the server
   - Only people with the complete URL can decrypt the content

## Technical Implementation

### Encryption Process

1. **Key Generation**:
   - For password-based encryption: PBKDF2 with 300,000 iterations of SHA-256
   - For key-based encryption: Cryptographically random 32-byte key

2. **Content Encryption**:
   - Generate a random 24-byte nonce
   - Encrypt the content using XSalsa20-Poly1305 with the key and nonce
   - For password protection: Combine `[salt + nonce + ciphertext]`
   - For key protection: Combine `[nonce + ciphertext]`
   - Encode the result as Base64 for transmission

### Decryption Process

1. **Key Retrieval**:
   - For password protection: User enters password, combined with extracted salt to derive the key
   - For key protection: Key is extracted from the URL fragment

2. **Content Decryption**:
   - Parse the encrypted data to extract nonce and ciphertext (and salt if password-protected)
   - Decrypt using XSalsa20-Poly1305 with the key and nonce
   - Display the decrypted content

## Security Considerations

- **No Trust Required**: The server has zero knowledge of the content
- **Forward Secrecy**: Each paste uses a unique key or salt
- **Safe Against Database Breaches**: Encrypted content is useless without the key or password
- **URL Security**: Encryption keys in URL fragments are never sent to the server but may be stored in browser history
- **Password Strength**: For password-protected pastes, security depends on password strength
- **Transport Security**: All communications use HTTPS for secure transit

## Implementation Details

Key crypto functions are implemented in `crypto.ts`:

- `generateEncryptionKey()`: Creates a random encryption key
- `deriveKeyFromPassword(password, salt?, progressCallback?)`: Uses PBKDF2 to derive a secure key
- `encryptData(data, key, isPasswordDerived?, salt?, progressCallback?)`: Encrypts data with appropriate formatting
- `decryptData(encrypted, keyOrPassword, isPasswordProtected?, progressCallback?)`: Decrypts data based on method

### Web Worker Optimization

For improved performance, we've implemented a Web Worker system to offload cryptographic operations:

1. **Performance Benefits**:
   - Prevents UI freezing during heavy cryptographic operations
   - Provides responsive feedback via progress reporting
   - Optimizes CPU utilization on multi-core systems

2. **Implementation Features**:
   - **Selective Offloading**: Only pastes larger than 10KB are processed in the worker
   - **Resource Management**: Workers are terminated after 60 seconds of inactivity
   - **Progress Reporting**: Provides real-time feedback during lengthy operations
   - **Graceful Degradation**: Falls back to main thread if Web Workers are unavailable

3. **Browser Compatibility**:
   - Automatically detects browser capabilities
   - Adapts based on available features (Web Workers, Web Crypto API)
   - Falls back to main thread for server-side rendering or older browsers

4. **User Experience**:
   - Progress bars for encryption/decryption operations
   - Appropriate UI feedback during processing
   - No UI freezing even with large pastes

## Future Enhancements

Planned security improvements include:

1. ✅ Password strength requirements and feedback
2. Option for additional server-side encryption (double encryption)
3. Automatic key rotation for long-lived pastes
4. Enhanced metadata protection (hiding language, creation time, etc.)
5. ✅ Web Worker optimization for heavy cryptographic operations
6. Support for file attachments with encryption
7. Hardware security key integration

## Legacy Support

For backward compatibility, we maintain support for the legacy server-side password verification, but this is being phased out in favor of the more secure client-side encryption.