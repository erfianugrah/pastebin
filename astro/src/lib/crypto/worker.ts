/**
 * Web Worker for crypto operations
 * Handles CPU-intensive encryption and decryption tasks in a separate thread
 */
import {
  deriveKeyFromPassword,
  encryptData,
  decryptData
} from './core';
import { WorkerOperation, ProgressData } from './utils';

/**
 * Handle messages from the main thread
 */
self.onmessage = async (event: MessageEvent) => {
  try {
    const { operation, params, requestId } = event.data;
    const reportProgress = params.reportProgress || false;
    
    // Progress reporting wrapper function
    const progressCallback = reportProgress 
      ? (progress: ProgressData) => {
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: progress.percent,
              requestId
            }
          });
        }
      : undefined;
    
    let result;
    switch (operation) {
      case 'deriveKey':
        result = await deriveKeyFromPassword(
          params.password, 
          params.salt,
          params.isLargeFile || false,
          progressCallback
        );
        break;
        
      case 'encrypt':
        result = await encryptData(
          params.data,
          params.key,
          params.isPasswordProtected,
          progressCallback
        );
        break;
        
      case 'decrypt':
        result = await decryptData(
          params.encrypted,
          params.key,
          params.isPasswordProtected,
          progressCallback
        );
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    self.postMessage({
      success: true,
      result,
      requestId
    });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      requestId: event.data.requestId
    });
  }
};

export {}; // Required to make TypeScript treat this as a module