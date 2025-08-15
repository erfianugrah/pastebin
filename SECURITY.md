# Security Configuration Guide

This document outlines the security measures implemented in the Pastebin application and how to configure them properly.

## Environment Variables

### Required Security Environment Variables

#### `ADMIN_API_KEY`
- **Required**: Yes
- **Purpose**: Secures administrative endpoints (`/api/analytics`, `/api/logs`, `/api/webhooks`)
- **Format**: Strong random string (minimum 32 characters)
- **Example**: `ADMIN_API_KEY=your-super-secure-random-api-key-here`
- **Generation**: 
  ```bash
  openssl rand -hex 32
  # or
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

### Optional Security Environment Variables

#### `ALLOWED_ORIGINS`
- **Purpose**: Restricts CORS to specific domains
- **Format**: Comma-separated list of allowed origins
- **Example**: `ALLOWED_ORIGINS=https://example.com,https://app.example.com`
- **Default**: If not set, only localhost origins are allowed in development

## Security Features Implemented

### 1. **Admin Endpoint Protection** ✅
- All administrative endpoints require Bearer token authentication
- Uses timing-safe string comparison to prevent timing attacks
- Returns proper 401 responses with WWW-Authenticate header

### 2. **CORS Security** ✅ 
- Strict origin validation with explicit allowlist
- No wildcard CORS in production
- Proper preflight handling

### 3. **XSS Prevention** ✅
- All user content uses `textContent` instead of `innerHTML`
- Safe DOM element creation throughout the application
- No template string interpolation with user data

### 4. **Content Security Policy** ✅
```
default-src 'self';
script-src 'self' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
connect-src 'self';
img-src 'self' data: blob:;
font-src 'self';
object-src 'none';
media-src 'self';
worker-src 'self' blob:;
child-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

### 5. **Secure Storage** ✅
- Encryption keys stored using AES-GCM encryption in localStorage
- Master key generated per browser session
- Automatic migration from plaintext storage
- Secure key derivation using PBKDF2

### 6. **Rate Limiting** ✅
- Path-based validation for static asset bypass prevention
- Stricter limits for POST operations
- IP-based tracking with Cloudflare KV

### 7. **Information Disclosure Prevention** ✅
- Stack traces only shown in development
- Generic error messages in production
- Sensitive debug logging restricted to localhost

### 8. **Security Headers** ✅
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` 
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`

### 9. **Client-Side Encryption Security** ✅
- End-to-end encryption using NaCl (XSalsa20-Poly1305)
- Secure key generation and management
- Protected inter-component communication with session tokens
- Memory-safe blob URL handling

## Usage Examples

### Admin API Authentication
```bash
# Get analytics (replace YOUR_API_KEY with actual key)
curl -H "Authorization: Bearer YOUR_API_KEY" https://your-domain.com/api/analytics

# Get logs
curl -H "Authorization: Bearer YOUR_API_KEY" https://your-domain.com/api/logs

# Manage webhooks
curl -H "Authorization: Bearer YOUR_API_KEY" https://your-domain.com/api/webhooks
```

### Development vs Production
- **Development**: Debug logging enabled for localhost
- **Production**: All sensitive logging disabled, stack traces hidden

## Security Checklist

Before deploying to production:

- [ ] `ADMIN_API_KEY` environment variable set with strong random key
- [ ] `ALLOWED_ORIGINS` configured with production domains
- [ ] All environment variables properly configured in Cloudflare Workers
- [ ] CSP headers tested with application functionality
- [ ] Admin endpoints tested with authentication
- [ ] Rate limiting tested and configured appropriately

## Security Monitoring

The application logs security-relevant events:
- Failed authentication attempts
- CORS violations
- Rate limit violations  
- Decryption failures
- Invalid session tokens

Monitor these logs regularly and set up alerts for suspicious activity.

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:
1. Do not create public issues for security vulnerabilities
2. Contact the maintainers privately
3. Provide detailed information about the vulnerability
4. Allow time for the issue to be fixed before disclosure

## Security Considerations

### Client-Side Encryption Limitations
- Decrypted content is visible in browser memory and developer tools
- This is an inherent limitation of client-side encryption
- Users should be aware that content is not protected from malicious browser extensions or local attacks

### Key Management
- Encryption keys are derived from URLs or passwords
- Keys stored in secure localStorage are encrypted but not protected from local attacks
- Consider implementing key rotation for long-term security

### Browser Compatibility  
- Modern browsers with Web Crypto API support required
- Fallback to regular localStorage for key storage if secure storage fails
- Service Worker caching may need periodic updates