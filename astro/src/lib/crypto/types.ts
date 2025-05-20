/**
 * Crypto Module Type Definitions
 * ==============================
 * 
 * This file contains shared type definitions used across the crypto module.
 */

//----------------------------------------------------------------------
// Worker Communication Types
//----------------------------------------------------------------------

/** Worker operation types */
export type WorkerOperation = 'encrypt' | 'decrypt' | 'deriveKey';

/** Unique identifier for request/response correlation */
export type RequestId = string;

/** Worker request message from main thread */
export interface WorkerRequest {
  operation: WorkerOperation;
  params: any;
  requestId: RequestId;
}

/** Worker response message to main thread */
export interface WorkerResponse {
  success: boolean;
  result?: any;
  error?: string;
  requestId: RequestId;
}

/** Progress data structure for reporting operation progress */
export interface ProgressData {
  operation: string;
  total: number;
  processed: number;
  requestId: RequestId;
  percent?: number;  // For compatibility with older code
}

/** Progress update message format */
export interface ProgressUpdate {
  progress: ProgressData;
}

//----------------------------------------------------------------------
// Callback Types
//----------------------------------------------------------------------

/** Progress callback function signature */
export type ProgressCallback = (progress: { percent: number }) => void;

/** Generic result with key and salt */
export interface KeyDerivationResult {
  key: Uint8Array;
  salt: Uint8Array;
}

/** Public API key derivation result (uses base64 strings) */
export interface PublicKeyDerivationResult {
  key: string;
  salt: string;
}