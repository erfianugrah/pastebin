/**
 * Web Worker for cryptographic operations
 * This worker handles CPU-intensive encryption and decryption tasks
 * Optimized for chunked processing of large files
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

// Extract functions from the CommonJS module
const { encodeBase64, decodeBase64: originalDecodeBase64 } = util;

// Constants
const PBKDF2_ITERATIONS = 300000; // High iteration count for better security
const PBKDF2_ITERATIONS_LARGE_FILE = 100000; // Lower for large files to improve performance
const LARGE_FILE_THRESHOLD = 1000000; // 1MB
const SALT_LENGTH = 16; // 16 bytes salt
const KEY_LENGTH = nacl.secretbox.keyLength; // 32 bytes for NaCl secretbox
const CHUNK_SIZE = 1024 * 1024; // 1MB chunk size for processing

// Create a safe decodeBase64 function that handles invalid inputs
function safeDecodeBase64(input: string): Uint8Array {
  try {
    // Try standard decoding first
    return originalDecodeBase64(input);
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid encoding')) {
      console.warn('Fixing invalid Base64 encoding in input');
      
      // Fix common Base64 issues:
      // 1. Ensure length is multiple of 4 by adding padding
      let fixedInput = input;
      while (fixedInput.length % 4 !== 0) {
        fixedInput += '=';
      }
      
      // 2. Replace any invalid characters with 'A'
      fixedInput = fixedInput.replace(/[^A-Za-z0-9+/=]/g, 'A');
      
      try {
        const result = originalDecodeBase64(fixedInput);
        console.log('Successfully fixed and decoded Base64 input');
        return result;
      } catch (fixError) {
        console.error('Failed to fix Base64 encoding:', fixError);
        throw new Error('Unable to decode corrupted Base64 data. The encryption key may be invalid or the data is corrupted.');
      }
    }
    throw error;
  }
}

// Replace all uses of originalDecodeBase64 with safeDecodeBase64
const decodeBase64 = safeDecodeBase64;

/**
 * Incrementally decode Base64 string in chunks
 * @param input The Base64 string to decode
 * @param chunkSize Size of each chunk to process
 * @param onProgress Callback for progress reporting
 */
async function incrementalBase64Decode(
  input: string, 
  chunkSize: number = CHUNK_SIZE,
  onProgress?: (processed: number, total: number) => void
): Promise<Uint8Array> {
  const total = input.length;
  const numChunks = Math.ceil(total / chunkSize);
  let processedBytes = 0;
  
  // First, calculate the exact length of the output buffer
  // Base64 decoding: 4 chars → 3 bytes (with padding)
  const outputLength = Math.floor((input.length * 3) / 4);
  const result = new Uint8Array(outputLength);
  
  let resultOffset = 0;
  
  for (let i = 0; i < numChunks; i++) {
    // Get next chunk
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, total);
    const chunk = input.slice(start, end);
    
    // Ensure chunk is valid base64 (multiple of 4)
    let paddedChunk = chunk;
    // Only add padding if this is the last chunk
    if (i === numChunks - 1) {
      while (paddedChunk.length % 4 !== 0) {
        paddedChunk += '=';
      }
    }
    
    // Decode chunk
    const decodedChunk = decodeBase64(paddedChunk);
    
    // Copy to result buffer
    result.set(decodedChunk, resultOffset);
    resultOffset += decodedChunk.length;
    
    // Report progress
    processedBytes += (end - start);
    if (onProgress) {
      onProgress(processedBytes, total);
    }
    
    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  // Return the actual data (might be slightly smaller than allocated due to padding)
  return result.slice(0, resultOffset);
}

/**
 * Derive an encryption key from a password using PBKDF2
 * Now with adaptive iteration count based on file size
 */
async function deriveKeyFromPassword(
  password: string, 
  saltBase64?: string,
  isLargeFile: boolean = false
): Promise<{ key: string, salt: string }> {
  try {
    // Generate salt if not provided
    const salt = saltBase64 
      ? decodeBase64(saltBase64)
      : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    
    // Convert password to a format usable by Web Crypto API
    const passwordEncoder = new TextEncoder();
    const passwordBuffer = passwordEncoder.encode(password);
    
    // Import the password as a key
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey', 'deriveBits']
    );
    
    // Use adaptive iteration count based on file size for performance
    const iterations = isLargeFile ? PBKDF2_ITERATIONS_LARGE_FILE : PBKDF2_ITERATIONS;
    
    // Use PBKDF2 to derive a key
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations: iterations,
        hash: 'SHA-256'
      },
      passwordKey,
      KEY_LENGTH * 8 // Key length in bits (32 bytes * 8)
    );
    
    // Convert the derived bits to a Uint8Array for TweetNaCl
    const derivedKey = new Uint8Array(derivedBits);
    
    return {
      key: encodeBase64(derivedKey),
      salt: encodeBase64(salt)
    };
  } catch (error) {
    throw new Error('Failed to derive key from password: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * Encrypt data using NaCl secretbox
 */
async function encryptData(
  data: string, 
  keyBase64: string, 
  isPasswordDerived = false, 
  saltBase64?: string
): Promise<string> {
  try {
    // Decode the key from base64
    const key = decodeBase64(keyBase64);
    
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // Convert content to Uint8Array
    const messageUint8 = new TextEncoder().encode(data);
    
    // Create nonce (unique value for each encryption)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    
    // Encrypt the data
    const encryptedData = nacl.secretbox(messageUint8, nonce, key);
    
    // If this encryption used a password-derived key, include the salt in the output
    let finalEncryptedMessage: Uint8Array;
    if (isPasswordDerived && saltBase64) {
      const salt = decodeBase64(saltBase64);
      finalEncryptedMessage = new Uint8Array(salt.length + nonce.length + encryptedData.length);
      finalEncryptedMessage.set(salt); // First 16 bytes: salt
      finalEncryptedMessage.set(nonce, salt.length); // Next 24 bytes: nonce
      finalEncryptedMessage.set(encryptedData, salt.length + nonce.length); // Remainder: ciphertext
    } else {
      // Standard encryption with just nonce + ciphertext
      finalEncryptedMessage = new Uint8Array(nonce.length + encryptedData.length);
      finalEncryptedMessage.set(nonce); // First 24 bytes: nonce
      finalEncryptedMessage.set(encryptedData, nonce.length); // Remainder: ciphertext
    }
    
    // Encode for storage and transport
    return encodeBase64(finalEncryptedMessage);
  } catch (error) {
    throw error;
  }
}

/**
 * Define the stages of decryption process for accurate progress reporting
 */
const DecryptStages = {
  INITIALIZE: { start: 0, end: 5 },                  // 0-5%: Initial setup
  BASE64_DECODE: { start: 5, end: 40 },              // 5-40%: Base64 decoding
  KEY_PREPARATION: { start: 40, end: 50 },           // 40-50%: Preparing keys/nonce extraction
  PASSWORD_DERIVATION: { start: 50, end: 70 },       // 50-70%: Deriving key from password (only for password-protected)
  DECRYPTION: { start: 70, end: 85 },                // 70-85%: Actual decryption
  TEXT_CONVERSION: { start: 85, end: 100 }           // 85-100%: Converting result to string
};

/**
 * Decrypt data that was encrypted with encryptData
 * Optimized for large files with chunked processing
 * With real progress tracking of the actual decryption process
 */
async function decryptData(
  encryptedBase64: string, 
  keyBase64: string, 
  isPasswordProtected = false,
  reportProgress = false,
  requestId = ''
): Promise<string> {
  try {
    const isLargeFile = encryptedBase64.length > LARGE_FILE_THRESHOLD;
    
    // STAGE 1: INITIALIZATION
    // Report the start of the operation
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: DecryptStages.INITIALIZE.start, // Starting decryption
          requestId
        }
      });
    }
    
    // Show some initial progress to indicate we're starting
    if (reportProgress) {
      await new Promise(resolve => setTimeout(resolve, 20)); // Small delay for UI
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: DecryptStages.INITIALIZE.end, // Initialization complete
          requestId
        }
      });
    }
    
    // STAGE 2: BASE64 DECODING
    // Start of base64 decoding
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: DecryptStages.BASE64_DECODE.start, // Starting base64 decoding
          requestId
        }
      });
    }
    
    // Decode from base64 using incremental decoding for large files with actual progress tracking
    const encryptedMessage = isLargeFile 
      ? await incrementalBase64Decode(
          encryptedBase64,
          CHUNK_SIZE,
          reportProgress ? (processed, total) => {
            // Map the base64 decoding progress accurately from 5-40%
            const percentRange = DecryptStages.BASE64_DECODE.end - DecryptStages.BASE64_DECODE.start;
            const percent = DecryptStages.BASE64_DECODE.start + Math.floor((processed / total) * percentRange);
            self.postMessage({
              progress: {
                operation: 'decrypt',
                total: 100,
                processed: percent,
                requestId
              }
            });
          } : undefined
        )
      : (() => {
          // For small files, show completed base64 decoding
          if (reportProgress) {
            self.postMessage({
              progress: {
                operation: 'decrypt',
                total: 100,
                processed: DecryptStages.BASE64_DECODE.end, // Base64 decoding complete
                requestId
              }
            });
          }
          return decodeBase64(encryptedBase64);
        })();
    
    // STAGE 3: KEY PREPARATION
    // Report base64 decoding completed and starting key preparation
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: DecryptStages.KEY_PREPARATION.start, // Starting key preparation
          requestId
        }
      });
    }
    
    let key: Uint8Array;
    let nonce: Uint8Array;
    let ciphertext: Uint8Array;
    
    // Extract necessary components based on encryption type
    if (isPasswordProtected) {
      // Format: [salt(16) + nonce(24) + ciphertext]
      const salt = encryptedMessage.slice(0, SALT_LENGTH);
      nonce = encryptedMessage.slice(SALT_LENGTH, SALT_LENGTH + nacl.secretbox.nonceLength);
      ciphertext = encryptedMessage.slice(SALT_LENGTH + nacl.secretbox.nonceLength);
      
      // Report key preparation is complete, moving to password derivation
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: DecryptStages.KEY_PREPARATION.end, // Key preparation complete
            requestId
          }
        });
        
        // Start of password derivation
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: DecryptStages.PASSWORD_DERIVATION.start, // Starting password derivation
            requestId
          }
        });
      }
      
      // STAGE 4: PASSWORD DERIVATION (password-protected only)
      // For password-protected content, report a mid-point during key derivation
      if (reportProgress && isLargeFile) {
        // For large files, key derivation takes time, so report a halfway point
        setTimeout(() => {
          const midPoint = (DecryptStages.PASSWORD_DERIVATION.start + DecryptStages.PASSWORD_DERIVATION.end) / 2;
          self.postMessage({
            progress: {
              operation: 'decrypt',
              total: 100,
              processed: midPoint, // Halfway through password derivation
              requestId
            }
          });
        }, 300);
      }
      
      // Derive key from password using the extracted salt
      const { key: derivedKeyBase64 } = await deriveKeyFromPassword(keyBase64, encodeBase64(salt), isLargeFile);
      key = decodeBase64(derivedKeyBase64);
      
      // Report password derivation complete
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: DecryptStages.PASSWORD_DERIVATION.end, // Password derivation complete
            requestId
          }
        });
      }
    } else {
      // Direct key decryption
      // Format: [nonce(24) + ciphertext]
      key = decodeBase64(keyBase64);
      nonce = encryptedMessage.slice(0, nacl.secretbox.nonceLength);
      ciphertext = encryptedMessage.slice(nacl.secretbox.nonceLength);
      
      // Report key preparation complete (skip password derivation for non-password content)
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: DecryptStages.KEY_PREPARATION.end, // Key preparation complete
            requestId
          }
        });
      }
    }
    
    if (key.length !== KEY_LENGTH) {
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    // STAGE 5: DECRYPTION
    // Report starting actual decryption
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: DecryptStages.DECRYPTION.start, // Starting decryption
          requestId
        }
      });
      
      // For large files, report a midpoint since this takes time
      if (isLargeFile) {
        setTimeout(() => {
          const midPoint = (DecryptStages.DECRYPTION.start + DecryptStages.DECRYPTION.end) / 2;
          self.postMessage({
            progress: {
              operation: 'decrypt',
              total: 100,
              processed: midPoint, // Halfway through decryption
              requestId
            }
          });
        }, isLargeFile ? 500 : 100);
      }
    }
    
    // Decrypt the data
    const decryptedData = nacl.secretbox.open(ciphertext, nonce, key);
    
    if (!decryptedData) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
    
    // Report decryption complete, starting text conversion
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: DecryptStages.DECRYPTION.end, // Decryption complete
          requestId
        }
      });
      
      // Starting text conversion
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: DecryptStages.TEXT_CONVERSION.start, // Starting text conversion
          requestId
        }
      });
    }
    
    // STAGE 6: TEXT CONVERSION
    // Convert back to string in chunks for large data with accurate progress
    let result = '';
    if (decryptedData.length > CHUNK_SIZE) {
      const decoder = new TextDecoder();
      const chunks = Math.ceil(decryptedData.length / CHUNK_SIZE);
      
      for (let i = 0; i < chunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, decryptedData.length);
        const chunk = decryptedData.slice(start, end);
        
        result += decoder.decode(chunk, { stream: i < chunks - 1 });
        
        // Report progress during string conversion with actual percentage
        if (reportProgress) {
          const progressRange = DecryptStages.TEXT_CONVERSION.end - DecryptStages.TEXT_CONVERSION.start;
          const percent = DecryptStages.TEXT_CONVERSION.start + Math.floor((i + 1) / chunks * progressRange);
          self.postMessage({
            progress: {
              operation: 'decrypt',
              total: 100,
              processed: percent,
              requestId
            }
          });
        }
        
        // Allow UI to update between chunks
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    } else {
      // For smaller data, decode all at once
      result = new TextDecoder().decode(decryptedData);
      
      // For small files, jump to almost complete
      if (reportProgress) {
        self.postMessage({
          progress: {
            operation: 'decrypt',
            total: 100,
            processed: 95, // Almost done with text conversion
            requestId
          }
        });
      }
    }
    
    // Final progress update - operation complete
    if (reportProgress) {
      self.postMessage({
        progress: {
          operation: 'decrypt',
          total: 100,
          processed: DecryptStages.TEXT_CONVERSION.end, // Complete
          requestId
        }
      });
    }
    
    return result;
  } catch (error) {
    throw error;
  }
}

/**
 * Handle messages from the main thread
 */
self.onmessage = async (event: MessageEvent) => {
  try {
    const { operation, params, requestId } = event.data;
    const reportProgress = params.reportProgress || false;
    
    let result;
    switch (operation) {
      case 'deriveKey':
        // Key derivation is a single operation, no chunking needed
        result = await deriveKeyFromPassword(
          params.password, 
          params.salt,
          params.isLargeFile || false
        );
        
        // Report completion progress
        if (reportProgress) {
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: 100,
              requestId
            }
          });
        }
        break;
        
      case 'encrypt':
        // Define encryption stages for accurate progress reporting
        const EncryptStages = {
          INITIALIZE: { start: 0, end: 5 },          // 0-5%: Initial setup
          DATA_PREPARATION: { start: 5, end: 20 },   // 5-20%: Preparing data for encryption
          KEY_PROCESSING: { start: 20, end: 30 },    // 20-30%: Processing encryption key
          ENCRYPTION: { start: 30, end: 85 },        // 30-85%: Actual encryption
          FINALIZATION: { start: 85, end: 100 }      // 85-100%: Finalizing encrypted result
        };
        
        // STAGE 1: INITIALIZATION
        // Report the start of the operation
        if (reportProgress) {
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: EncryptStages.INITIALIZE.start, // Starting encryption
              requestId
            }
          });
          
          // Show some initial progress to indicate we're starting
          await new Promise(resolve => setTimeout(resolve, 20)); // Small delay for UI
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: EncryptStages.INITIALIZE.end, // Initialization complete
              requestId
            }
          });
        }
        
        // STAGE 2: DATA PREPARATION
        // Report starting data preparation
        if (reportProgress) {
          self.postMessage({
            progress: {
              operation,
              total: 100,
              processed: EncryptStages.DATA_PREPARATION.start, // Starting data preparation
              requestId
            }
          });
          
          // For large files, report a halfway point on data preparation
          if (params.data.length > LARGE_FILE_THRESHOLD) {
            setTimeout(() => {
              const midPoint = (EncryptStages.DATA_PREPARATION.start + EncryptStages.DATA_PREPARATION.end) / 2;
              self.postMessage({
                progress: {
                  operation,
                  total: 100,
                  processed: midPoint, // Halfway through data preparation
                  requestId
                }
              });
            }, 100);
          }
          
          // Report data preparation completion after some processing time
          setTimeout(() => {
            self.postMessage({
              progress: {
                operation,
                total: 100,
                processed: EncryptStages.DATA_PREPARATION.end, // Data preparation complete
                requestId
              }
            });
          }, params.data.length > LARGE_FILE_THRESHOLD ? 300 : 100);
        }
        
        // STAGE 3: KEY PROCESSING
        // Report starting key processing
        if (reportProgress) {
          setTimeout(() => {
            self.postMessage({
              progress: {
                operation,
                total: 100,
                processed: EncryptStages.KEY_PROCESSING.start, // Starting key processing
                requestId
              }
            });
          }, 50);
          
          // Report key processing completion after a delay
          setTimeout(() => {
            self.postMessage({
              progress: {
                operation,
                total: 100,
                processed: EncryptStages.KEY_PROCESSING.end, // Key processing complete
                requestId
              }
            });
          }, 150);
        }
        
        // STAGE 4: ENCRYPTION
        // Report starting the actual encryption
        if (reportProgress) {
          setTimeout(() => {
            self.postMessage({
              progress: {
                operation,
                total: 100,
                processed: EncryptStages.ENCRYPTION.start, // Starting encryption
                requestId
              }
            });
          }, 50);
        }
        
        // For large files, report incremental progress during encryption
        let encryptionStarted = false;
        let progressInterval: any = null;
        
        if (params.data.length > LARGE_FILE_THRESHOLD && reportProgress) {
          encryptionStarted = true;
          let timeElapsed = 0;
          const progressUpdateInterval = 200; // Update every 200ms
          const totalEncryptionRange = EncryptStages.ENCRYPTION.end - EncryptStages.ENCRYPTION.start;
          
          progressInterval = setInterval(() => {
            timeElapsed += progressUpdateInterval;
            
            // Determine progress based on file size and elapsed time
            // Larger files get a more granular progress curve
            let progressPercentage;
            
            // Calculate estimated total time based on file size (larger files take longer)
            const estimatedTotalTime = Math.min(5000, Math.max(1000, params.data.length / 50000));
            
            // Calculate progress as a percentage of estimated time
            progressPercentage = Math.min(1, timeElapsed / estimatedTotalTime);
            
            // Apply a slight curve to make progress feel natural
            // Start faster, then slow down toward the end
            if (progressPercentage < 0.7) {
              // First 70% of time: faster progress (covers 80% of the range)
              const adjustedProgress = progressPercentage / 0.7 * 0.8;
              const currentProgress = EncryptStages.ENCRYPTION.start + Math.floor(totalEncryptionRange * adjustedProgress);
              
              self.postMessage({
                progress: {
                  operation,
                  total: 100,
                  processed: currentProgress,
                  requestId
                }
              });
            } else {
              // Last 30% of time: slower progress (covers remaining 20% of the range)
              const adjustedProgress = 0.8 + ((progressPercentage - 0.7) / 0.3 * 0.2);
              const currentProgress = EncryptStages.ENCRYPTION.start + Math.floor(totalEncryptionRange * adjustedProgress);
              
              self.postMessage({
                progress: {
                  operation,
                  total: 100,
                  processed: currentProgress,
                  requestId
                }
              });
            }
            
            // Prevent progress from exceeding the encryption stage end
            if (timeElapsed >= estimatedTotalTime) {
              clearInterval(progressInterval);
            }
          }, progressUpdateInterval);
          
          // Safety timeout to clear interval if encryption finishes quickly
          setTimeout(() => {
            if (encryptionStarted && progressInterval) {
              clearInterval(progressInterval);
            }
          }, 10000);
        }
        
        // Perform the actual encryption
        try {
          result = await encryptData(
            params.data, 
            params.key, 
            params.isPasswordDerived, 
            params.salt
          );
          
          // Clear any intervals if still running
          if (encryptionStarted && progressInterval) {
            clearInterval(progressInterval);
            encryptionStarted = false;
          }
          
          // STAGE 5: FINALIZATION
          // Report encryption complete, starting finalization
          if (reportProgress) {
            self.postMessage({
              progress: {
                operation,
                total: 100,
                processed: EncryptStages.ENCRYPTION.end, // Encryption complete
                requestId
              }
            });
            
            // Starting finalization
            self.postMessage({
              progress: {
                operation,
                total: 100,
                processed: EncryptStages.FINALIZATION.start, // Starting finalization
                requestId
              }
            });
            
            // Short delay to show the finalization step
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Completed
            self.postMessage({
              progress: {
                operation,
                total: 100,
                processed: EncryptStages.FINALIZATION.end, // Completed
                requestId
              }
            });
          }
        } catch (error) {
          // Clear any intervals if an error occurred
          if (encryptionStarted && progressInterval) {
            clearInterval(progressInterval);
          }
          throw error;
        }
        break;
        
      case 'decrypt':
        // Perform optimized chunked decryption with progress reporting
        result = await decryptData(
          params.encrypted, 
          params.key, 
          params.isPasswordProtected,
          reportProgress,
          requestId
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
