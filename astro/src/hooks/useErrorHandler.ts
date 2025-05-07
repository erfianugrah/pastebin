/**
 * React hook for consistent error handling in components
 */
import { useState, useCallback } from 'react';
import { toast } from '../components/ui/toast';
import { clientLogger } from '../../../src/infrastructure/logging/clientLogger';
import { ErrorCategory, getUserFriendlyMessage } from '../../../src/infrastructure/errors/errorHandler';

interface ErrorState {
  error: Error | null;
  errorMessage: string | null;
  category: ErrorCategory | null;
}

interface UseErrorHandlerOptions {
  showToast?: boolean;
  logErrors?: boolean;
}

export function useErrorHandler(options: UseErrorHandlerOptions = {}) {
  const { showToast = true, logErrors = true } = options;
  const [errorState, setErrorState] = useState<ErrorState>({
    error: null,
    errorMessage: null,
    category: null
  });

  const handleError = useCallback((error: unknown, context: Record<string, any> = {}) => {
    // Convert to Error if not already
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    // Get user-friendly message
    const message = getUserFriendlyMessage(errorObj);
    
    // Determine error category
    let category: ErrorCategory = ErrorCategory.UNKNOWN;
    if ('code' in errorObj && typeof errorObj.code === 'string') {
      // Check for known error codes
      if (errorObj.code.includes('network')) category = ErrorCategory.NETWORK;
      if (errorObj.code.includes('timeout')) category = ErrorCategory.TIMEOUT;
      if (errorObj.code.includes('storage')) category = ErrorCategory.STORAGE;
      if (errorObj.code.includes('crypto')) category = ErrorCategory.CRYPTO;
      if (errorObj.code.includes('validation')) category = ErrorCategory.VALIDATION;
    } else {
      // Check message content
      const errorMessage = errorObj.message.toLowerCase();
      if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        category = ErrorCategory.NETWORK;
      } else if (errorMessage.includes('timeout')) {
        category = ErrorCategory.TIMEOUT;
      } else if (errorMessage.includes('storage') || errorMessage.includes('quota')) {
        category = ErrorCategory.STORAGE;
      } else if (errorMessage.includes('decrypt') || errorMessage.includes('encrypt')) {
        category = ErrorCategory.CRYPTO;
      } else if (errorMessage.includes('valid') || errorMessage.includes('required')) {
        category = ErrorCategory.VALIDATION;
      }
    }

    // Set error state
    setErrorState({
      error: errorObj,
      errorMessage: message,
      category
    });

    // Log the error if enabled
    if (logErrors) {
      clientLogger.error({
        message: errorObj.message,
        category,
        context,
        stack: errorObj.stack
      });
    }

    // Show toast if enabled
    if (showToast) {
      toast({
        message,
        type: 'error',
        duration: 5000
      });
    }

    return errorObj;
  }, [showToast, logErrors]);

  const clearError = useCallback(() => {
    setErrorState({
      error: null,
      errorMessage: null,
      category: null
    });
  }, []);

  // Wrap an async function with error handling
  const withErrorHandling = useCallback(<T>(
    fn: () => Promise<T>,
    context: Record<string, any> = {}
  ): Promise<T> => {
    return fn().catch(error => {
      handleError(error, context);
      throw error; // Re-throw to allow component to handle it if needed
    });
  }, [handleError]);

  return {
    ...errorState,
    handleError,
    clearError,
    withErrorHandling
  };
}