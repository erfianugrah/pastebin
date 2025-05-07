/**
 * React hook for handling async effects with proper error handling
 */
import { useEffect } from 'react';
import { clientLogger } from '../../../src/infrastructure/logging/clientLogger';
import { ErrorCategory } from '../../../src/infrastructure/errors/errorHandler';

/**
 * Options for useAsyncEffect hook
 */
interface UseAsyncEffectOptions {
  onError?: (error: Error) => void;
  logErrors?: boolean;
  skipIf?: boolean;
}

/**
 * A wrapper for useEffect that handles async functions with proper error handling
 * 
 * @param effect Async function to run as effect
 * @param deps Dependency array for the effect
 * @param options Options for error handling
 */
export function useAsyncEffect(
  effect: () => Promise<void | (() => void)>,
  deps: React.DependencyList = [],
  options: UseAsyncEffectOptions = {}
) {
  const { onError, logErrors = true, skipIf = false } = options;

  useEffect(() => {
    // Skip effect if skipIf is true
    if (skipIf) return;

    let cleanupFunction: void | (() => void);
    let isMounted = true;

    const runEffect = async () => {
      try {
        // Execute the effect
        cleanupFunction = await effect();
      } catch (error) {
        // Handle errors
        const errorObj = error instanceof Error ? error : new Error(String(error));
        
        // Determine error category for logging
        let category = ErrorCategory.UNKNOWN;
        if (errorObj.message.includes('network') || errorObj.message.includes('fetch')) {
          category = ErrorCategory.NETWORK;
        } else if (errorObj.message.includes('timeout')) {
          category = ErrorCategory.TIMEOUT;
        } else if (errorObj.message.includes('storage') || errorObj.message.includes('quota')) {
          category = ErrorCategory.STORAGE;
        } else if (errorObj.message.includes('decrypt') || errorObj.message.includes('encrypt')) {
          category = ErrorCategory.CRYPTO;
        }
        
        // Log the error if enabled
        if (logErrors) {
          clientLogger.error({
            message: `Error in async effect: ${errorObj.message}`,
            category,
            stack: errorObj.stack
          });
        }
        
        // Call the error handler if provided
        if (onError && isMounted) {
          onError(errorObj);
        }
      }
    };

    // Run the effect
    runEffect();

    // Cleanup function
    return () => {
      isMounted = false;
      if (typeof cleanupFunction === 'function') {
        cleanupFunction();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}