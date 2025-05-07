/**
 * React hook for handling timeouts safely
 */
import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook for safely managing timeouts in React components
 * Automatically cleans up the timeout when the component unmounts
 * 
 * @param callback Function to call when the timeout expires
 * @param delay Timeout delay in milliseconds, or null to pause the timeout
 * @returns Functions to clear or reset the timeout
 */
export function useTimeout(callback: () => void, delay: number | null) {
  // Store the callback in a ref to avoid unnecessary rerenders
  const callbackRef = useRef(callback);
  // Store the timeout ID for cleanup
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Update the callback ref when the callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Set up the timeout
  useEffect(() => {
    // Skip if delay is null
    if (delay === null) return;

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set up new timeout
    timeoutRef.current = setTimeout(() => {
      callbackRef.current();
    }, delay);

    // Clean up on unmount or delay change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [delay]);

  // Function to clear the timeout
  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  // Function to reset the timeout
  const reset = useCallback(() => {
    // Clear existing timeout
    clear();

    // Skip if delay is null
    if (delay === null) return;

    // Set up new timeout
    timeoutRef.current = setTimeout(() => {
      callbackRef.current();
    }, delay);
  }, [delay, clear]);

  return { clear, reset };
}