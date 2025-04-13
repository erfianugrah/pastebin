# Browser Integration Features for End-to-End Encryption

This document describes the browser integration features implemented to enhance the end-to-end encryption (E2EE) user experience in Pasteriser.

## Overview

The browser integration features leverage modern browser capabilities to provide a more seamless and secure encryption/decryption experience without compromising on security principles. All cryptographic operations still occur client-side, with enhanced usability through browser features.

## Key Features

### 1. Password Manager Integration

Users can securely save and auto-fill encryption passwords using their browser's built-in password manager:

- **Creation Form**: Uses `autocomplete="new-password"` attribute to properly hint password managers about new passwords
- **Decryption Form**: Uses `autocomplete="current-password"` attribute to properly hint password managers about existing passwords
- **Password Storage**: Avoids custom storage mechanisms for raw passwords and instead integrates with browser security features

### 2. Copy to Clipboard Functions

One-click functions to copy sensitive information:

- **Copy Full URL**: Easily copy the complete URL including the fragment identifier containing the encryption key
- **Copy Encryption Key**: Extract and copy just the encryption key portion for secure sharing
- **Success Feedback**: Clear toast notifications indicate when content has been copied

### 3. Local Key Storage

Secure persistence of encryption keys for return visits:

- **Save Key Button**: Option to store the encryption key in the browser's localStorage
- **Key Format**: Saves direct keys and derived keys in different formats
- **Key Retrieval**: Automatically attempts to use stored keys when visiting a paste again
- **Permission-Based**: Always asks for user permission before storing sensitive information
- **Error Handling**: Automatically cleans up invalid or expired keys

### 4. Password-Derived Key Storage

Securely remember passwords without storing actual passwords:

- **Opt-In Storage**: Asks users if they want to remember a password after successful decryption
- **Key Derivation**: Instead of storing the raw password, derives and stores a key specific to the paste
- **Format Indication**: Keys derived from passwords are stored with a special prefix (`dk:`) to distinguish them
- **Local Only**: All storage is browser-local and never transmitted to the server

## Implementation Details

### Storage Format

Keys in localStorage follow these formats:

1. **Direct Keys**: `paste_key_[PASTE_ID] = "raw-encryption-key"`
2. **Password-Derived Keys**: `paste_key_[PASTE_ID] = "dk:[SALT]:[DERIVED_KEY]"`

### Security Considerations

- **Browser Storage Limitations**: localStorage is not the most secure storage mechanism, but provides a reasonable balance between usability and security for most use cases
- **No Raw Password Storage**: Raw passwords are never stored, even in localStorage
- **Encrypted Transport**: All communication still happens over HTTPS
- **Transparent UX**: Clear indications when keys are being saved or used from storage
- **Manual Override**: Users can always enter passwords manually or paste keys
- **Automatic Cleanup**: Invalid keys are automatically removed

### Future Enhancements

1. **IndexedDB**: Migration to more secure browser storage APIs
2. **Browser Extension**: Potential for a dedicated browser extension for enhanced security
3. **WebAuthn Support**: Integration with biometric and hardware security keys

## Browser Compatibility

These features are supported in all modern browsers:

- Chrome/Edge (version 60+)
- Firefox (version 55+)
- Safari (version 11+)
- Opera (version 47+)

Older browsers may not support some features like copy-to-clipboard or have limited password manager integration.