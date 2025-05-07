/**
 * Centralized error handling utilities
 * Provides consistent error handling functions across the application
 */
import { AppError, NetworkError, CryptoError, TimeoutError, ValidationError, StorageError } from './errorTypes';
import { logger } from '../logging/loggerFactory';

// Error categories for classification
export enum ErrorCategory {
  NETWORK = 'network',
  CRYPTO = 'crypto',
  VALIDATION = 'validation',
  STORAGE = 'storage',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

/**
 * Determine the category of an error
 */
export function categorizeError(error: Error): ErrorCategory {
  if (error instanceof NetworkError) return ErrorCategory.NETWORK;
  if (error instanceof CryptoError) return ErrorCategory.CRYPTO;
  if (error instanceof ValidationError) return ErrorCategory.VALIDATION;
  if (error instanceof StorageError) return ErrorCategory.STORAGE;
  if (error instanceof TimeoutError) return ErrorCategory.TIMEOUT;
  
  // Check for fetch/network errors
  if (error.message.includes('fetch') || 
      error.message.includes('network') || 
      error.message.toLowerCase().includes('cors')) {
    return ErrorCategory.NETWORK;
  }
  
  // Check for crypto errors
  if (error.message.includes('decrypt') || 
      error.message.includes('encrypt') || 
      error.message.includes('key')) {
    return ErrorCategory.CRYPTO;
  }
  
  // Check for timeout errors
  if (error.message.includes('timeout') || 
      error.message.includes('timed out')) {
    return ErrorCategory.TIMEOUT;
  }
  
  // Check for storage errors
  if (error.message.includes('storage') || 
      error.message.includes('quota') || 
      error.message.includes('localStorage')) {
    return ErrorCategory.STORAGE;
  }
  
  return ErrorCategory.UNKNOWN;
}

/**
 * Get a user-friendly error message based on error type
 */
export function getUserFriendlyMessage(error: Error): string {
  // If it's our app error, use its message directly
  if (error instanceof AppError) return error.message;
  
  // Generate user-friendly messages based on error category
  const category = categorizeError(error);
  
  switch (category) {
    case ErrorCategory.NETWORK:
      return 'Network error. Please check your connection and try again.';
    case ErrorCategory.CRYPTO:
      if (error.message.includes('decrypt')) {
        return 'Unable to decrypt content. The key or password may be incorrect.';
      }
      if (error.message.includes('encrypt')) {
        return 'Encryption failed. Please try again.';
      }
      return 'Encryption error. Please try again.';
    case ErrorCategory.VALIDATION:
      return 'Invalid input. Please check your data and try again.';
    case ErrorCategory.STORAGE:
      if (error.message.includes('quota')) {
        return 'Storage quota exceeded. Please clear some space and try again.';
      }
      return 'Storage error. Please try again.';
    case ErrorCategory.TIMEOUT:
      return 'The operation timed out. Please try again.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

/**
 * Safely log errors without exposing sensitive information
 */
export function logError(error: Error, context: Record<string, any> = {}): void {
  // Create a sanitized version of the context
  const sanitizedContext = { ...context };
  
  // Remove any sensitive fields
  const sensitiveFields = ['password', 'key', 'token', 'secret', 'encryptionKey'];
  sensitiveFields.forEach(field => {
    if (field in sanitizedContext) {
      sanitizedContext[field] = '[REDACTED]';
    }
  });
  
  // Categorize the error
  const category = categorizeError(error);
  
  // Log appropriate information based on error type
  if (error instanceof AppError) {
    logger.error(`${error.message}`, {
      code: error.code,
      category,
      context: sanitizedContext,
      stack: (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') ? error.stack : undefined
    });
  } else {
    logger.error(`${error.message}`, {
      category,
      context: sanitizedContext,
      stack: (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') ? error.stack : undefined
    });
  }
}

/**
 * Handle common errors in an async function
 * Wraps the function in a try/catch block and provides consistent error handling
 */
export function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: {
    onError?: (error: Error) => void,
    context?: Record<string, any>,
    rethrow?: boolean
  } = {}
): Promise<T> {
  const { onError, context = {}, rethrow = false } = options;
  
  return fn().catch(error => {
    // Log the error
    logError(error, context);
    
    // Call custom error handler if provided
    if (onError) {
      onError(error);
    }
    
    // Rethrow if required
    if (rethrow) {
      throw error;
    }
    
    // Return a rejected promise
    return Promise.reject(error);
  });
}

/**
 * Create a timeout wrapper for promises
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: number | ReturnType<typeof setTimeout>;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(timeoutMessage));
    }, timeoutMs);
  });
  
  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => {
    clearTimeout(timeoutId);
  });
}