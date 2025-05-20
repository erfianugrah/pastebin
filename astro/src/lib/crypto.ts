/**
 * Crypto Module - Main Entry Point
 * ===============================
 * 
 * This file serves as a barrel export to maintain backward compatibility
 * with existing code that imports from '../lib/crypto'.
 * It re-exports the public API from the new modular crypto implementation.
 */

// Re-export everything from the new crypto module
export * from './crypto/index';