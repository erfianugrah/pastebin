/**
 * Client-side error handling utilities for Astro components
 */
import { clientLogger } from '../../../src/infrastructure/logging/clientLogger';
import { toast } from '../components/ui/toast';
import { ErrorCategory } from '../../../src/infrastructure/errors/errorHandler';

// Map of error types to user-friendly messages
const ERROR_MESSAGES: Record<string, string> = {
  'network': 'Network error. Please check your connection and try again.',
  'timeout': 'The operation timed out. Please try again.',
  'decryption': 'Unable to decrypt the content. The encryption key or password may be incorrect.',
  'encryption': 'Failed to encrypt content. Please try again.',
  'validation': 'Please check your input and try again.',
  'storage': 'Your browser storage is full or unavailable. Try clearing some space.',
  'auth': 'Authentication error. Please log in again.',
  'permission': 'You do not have permission to perform this action.',
  'not_found': 'The requested content could not be found.',
  'server': 'The server encountered an error. Please try again later.',
  'quota_exceeded': 'Storage quota exceeded. Please clear some space and try again.',
  'browser_compatibility': 'Your browser may not support all features of this application.',
  'unknown': 'An unexpected error occurred. Please try again.'
};

// Helper to extract error category from error
export function getErrorCategory(error: Error | unknown): ErrorCategory {
  if (!error) return ErrorCategory.UNKNOWN;
  
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (errorMessage.includes('network') || 
      errorMessage.includes('fetch') || 
      errorMessage.includes('connection')) {
    return ErrorCategory.NETWORK;
  }
  
  if (errorMessage.includes('decrypt') || 
      errorMessage.includes('encrypt') || 
      errorMessage.includes('crypto')) {
    return ErrorCategory.CRYPTO;
  }
  
  if (errorMessage.includes('timeout') || 
      errorMessage.includes('timed out')) {
    return ErrorCategory.TIMEOUT;
  }
  
  if (errorMessage.includes('storage') || 
      errorMessage.includes('localStorage') || 
      errorMessage.includes('quota')) {
    return ErrorCategory.STORAGE;
  }
  
  if (errorMessage.includes('valid') || 
      errorMessage.includes('format') || 
      errorMessage.includes('required')) {
    return ErrorCategory.VALIDATION;
  }
  
  return ErrorCategory.UNKNOWN;
}

// Get a user-friendly error message
export function getUserFriendlyMessage(error: Error | unknown): string {
  if (!error) return ERROR_MESSAGES.unknown;
  
  const category = getErrorCategory(error);
  
  if (category === ErrorCategory.NETWORK) return ERROR_MESSAGES.network;
  if (category === ErrorCategory.CRYPTO) {
    if (error instanceof Error && error.message.includes('decrypt')) {
      return ERROR_MESSAGES.decryption;
    }
    if (error instanceof Error && error.message.includes('encrypt')) {
      return ERROR_MESSAGES.encryption;
    }
    return ERROR_MESSAGES.crypto;
  }
  if (category === ErrorCategory.TIMEOUT) return ERROR_MESSAGES.timeout;
  if (category === ErrorCategory.STORAGE) {
    if (error instanceof Error && error.message.includes('quota')) {
      return ERROR_MESSAGES.quota_exceeded;
    }
    return ERROR_MESSAGES.storage;
  }
  if (category === ErrorCategory.VALIDATION) return ERROR_MESSAGES.validation;
  
  return ERROR_MESSAGES.unknown;
}

// Show toast error message
export function showErrorToast(error: Error | unknown): void {
  const message = getUserFriendlyMessage(error);
  toast({
    message,
    type: 'error',
    duration: 5000,
  });
}

// Log error to clientLogger
export function logError(error: Error | unknown, context: Record<string, any> = {}): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const category = getErrorCategory(error);
  
  clientLogger.error({
    message: errorMessage,
    category,
    stack,
    ...context
  });
}

// Handle error with both logging and user notification
export function handleError(error: Error | unknown, context: Record<string, any> = {}): void {
  logError(error, context);
  showErrorToast(error);
}

// Wrap an async function with error handling
export function withErrorHandling<T>(
  asyncFn: () => Promise<T>,
  options: {
    onError?: (error: Error | unknown) => void,
    context?: Record<string, any>,
    showToast?: boolean,
    rethrow?: boolean
  } = {}
): Promise<T> {
  const { 
    onError, 
    context = {}, 
    showToast = true, 
    rethrow = false 
  } = options;
  
  return asyncFn().catch(error => {
    // Log the error
    logError(error, context);
    
    // Show toast if requested
    if (showToast) {
      showErrorToast(error);
    }
    
    // Call custom error handler if provided
    if (onError) {
      onError(error);
    }
    
    // Rethrow if requested
    if (rethrow) {
      throw error;
    }
    
    // Return a rejected promise
    return Promise.reject(error);
  });
}

// Create a timeout wrapper for promises
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: number;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  
  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}