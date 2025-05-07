/**
 * Error type definitions for the Pastebin application
 * This file defines standardized error classes to improve error handling consistency
 */

// Base application error class
export class AppError extends Error {
  public code: string;
  public statusCode: number;
  public details?: Record<string, any>;
  
  constructor(message: string, code: string, statusCode = 500, details?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    
    // Maintains proper stack trace for where our error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  // Convert to a safe object for sending to clients
  public toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        // Only include details if they exist and we're in development
        ...(this.details && process.env.NODE_ENV === 'development' ? { details: this.details } : {})
      }
    };
  }
}

// Network related errors
export class NetworkError extends AppError {
  constructor(message: string, code = 'network_error', statusCode = 503, details?: Record<string, any>) {
    super(message, code, statusCode, details);
  }
}

// Validation errors
export class ValidationError extends AppError {
  constructor(message: string, code = 'validation_error', statusCode = 400, details?: Record<string, any>) {
    super(message, code, statusCode, details);
  }
}

// Authentication errors
export class AuthError extends AppError {
  constructor(message: string, code = 'auth_error', statusCode = 401, details?: Record<string, any>) {
    super(message, code, statusCode, details);
  }
}

// Not found errors
export class NotFoundError extends AppError {
  constructor(message: string, code = 'not_found', statusCode = 404, details?: Record<string, any>) {
    super(message, code, statusCode, details);
  }
}

// Rate limiting errors
export class RateLimitError extends AppError {
  constructor(message: string, code = 'rate_limit_exceeded', statusCode = 429, details?: Record<string, any>) {
    super(message, code, statusCode, details);
  }
}

// Storage related errors
export class StorageError extends AppError {
  constructor(message: string, code = 'storage_error', statusCode = 500, details?: Record<string, any>) {
    super(message, code, statusCode, details);
  }
}

// Encryption related errors
export class CryptoError extends AppError {
  constructor(message: string, code = 'crypto_error', statusCode = 400, details?: Record<string, any>) {
    super(message, code, statusCode, details);
  }
}

// Specific crypto errors
export class DecryptionError extends CryptoError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'decryption_error', 400, details);
  }
}

export class EncryptionError extends CryptoError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'encryption_error', 400, details);
  }
}

export class InvalidKeyError extends CryptoError {
  constructor(message = 'Invalid encryption key format', details?: Record<string, any>) {
    super(message, 'invalid_key', 400, details);
  }
}

// Timeout errors
export class TimeoutError extends AppError {
  constructor(message: string, code = 'timeout', statusCode = 408, details?: Record<string, any>) {
    super(message, code, statusCode, details);
  }
}

// Browser incompatibility errors
export class BrowserCompatibilityError extends AppError {
  constructor(message: string, feature: string, details?: Record<string, any>) {
    super(
      message,
      'browser_compatibility', 
      400, 
      { ...details, feature }
    );
  }
}

// Storage quota exceeded
export class QuotaExceededError extends StorageError {
  constructor(message = 'Storage quota exceeded', details?: Record<string, any>) {
    super(message, 'quota_exceeded', 507, details);
  }
}