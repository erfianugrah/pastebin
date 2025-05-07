/**
 * Frontend error type definitions for consistent error handling
 */

// Error categories for classification
export enum ErrorCategory {
  NETWORK = 'network',
  CRYPTO = 'crypto',
  VALIDATION = 'validation',
  STORAGE = 'storage',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

// Base error class
export class AppError extends Error {
  public code: string;
  public category: ErrorCategory;
  public details?: Record<string, any>;

  constructor(
    message: string, 
    code: string = 'app_error', 
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.category = category;
    this.details = details;
  }
}

// Network-related errors
export class NetworkError extends AppError {
  constructor(message: string, code: string = 'network_error', details?: Record<string, any>) {
    super(message, code, ErrorCategory.NETWORK, details);
    this.name = 'NetworkError';
  }
}

// Crypto-related errors
export class CryptoError extends AppError {
  constructor(message: string, code: string = 'crypto_error', details?: Record<string, any>) {
    super(message, code, ErrorCategory.CRYPTO, details);
    this.name = 'CryptoError';
  }
}

// Validation errors
export class ValidationError extends AppError {
  constructor(message: string, code: string = 'validation_error', details?: Record<string, any>) {
    super(message, code, ErrorCategory.VALIDATION, details);
    this.name = 'ValidationError';
  }
}

// Storage-related errors
export class StorageError extends AppError {
  constructor(message: string, code: string = 'storage_error', details?: Record<string, any>) {
    super(message, code, ErrorCategory.STORAGE, details);
    this.name = 'StorageError';
  }
}

// Timeout errors
export class TimeoutError extends AppError {
  constructor(message: string = 'Operation timed out', code: string = 'timeout_error', details?: Record<string, any>) {
    super(message, code, ErrorCategory.TIMEOUT, details);
    this.name = 'TimeoutError';
  }
}