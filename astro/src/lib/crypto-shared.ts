/**
 * Shared cryptographic constants and utilities used by both the main thread
 * (crypto.ts) and the Web Worker (crypto-worker.ts).
 *
 * Keeping a single source of truth avoids subtle divergence between the two
 * execution contexts.
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

// Re-export the encode helper as-is
export const { encodeBase64 } = util;

// ---- Constants ----

export const PBKDF2_ITERATIONS = 300000; // High iteration count for better security
export const SALT_LENGTH = 16; // 16 bytes salt
export const KEY_LENGTH = nacl.secretbox.keyLength; // 32 bytes for NaCl secretbox
export const LARGE_FILE_THRESHOLD = 1000000; // 1 MB threshold for large file optimizations

/**
 * Chunk size for incremental Base64 processing.
 * MUST be a multiple of 4 so every non-final chunk is independently
 * decodable without padding.
 */
export const CHUNK_SIZE = 1024 * 1024; // 1 MB (divisible by 4)

// ---- Safe Base64 decoding ----

const { decodeBase64: originalDecodeBase64 } = util;

/**
 * Decode a Base64 string, tolerating missing trailing padding (`=`).
 *
 * Throws on invalid characters rather than silently corrupting data.
 */
export function safeDecodeBase64(input: string): Uint8Array {
	// Reject inputs with invalid characters rather than silently corrupting data
	if (/[^A-Za-z0-9+/=]/.test(input)) {
		throw new Error(
			'Invalid Base64 input: contains characters outside the Base64 alphabet. The encryption key may be invalid or the data is corrupted.',
		);
	}

	// Add missing padding (common when keys are copied from URLs)
	let padded = input;
	while (padded.length % 4 !== 0) {
		padded += '=';
	}

	try {
		return originalDecodeBase64(padded);
	} catch {
		throw new Error('Unable to decode Base64 data. The encryption key may be invalid or the data is corrupted.');
	}
}

/** Convenience alias */
export const decodeBase64 = safeDecodeBase64;

// ---- Incremental Base64 decoding ----

/**
 * Decode a Base64 string in aligned chunks so the UI / worker can yield
 * between iterations.
 *
 * @param input      Full Base64 string
 * @param chunkSize  Characters per chunk — will be rounded DOWN to the
 *                   nearest multiple of 4 to guarantee alignment.
 * @param onProgress Optional callback invoked after each chunk.
 */
export async function incrementalBase64Decode(
	input: string,
	chunkSize: number = CHUNK_SIZE,
	onProgress?: (processed: number, total: number) => void,
): Promise<Uint8Array> {
	// Ensure chunk boundaries always fall on a 4-char Base64 group
	const alignedChunkSize = Math.max(4, Math.floor(chunkSize / 4) * 4);

	const total = input.length;
	const numChunks = Math.ceil(total / alignedChunkSize);
	let processedBytes = 0;

	// Upper-bound output length (exact for unpadded input)
	const outputLength = Math.floor((total * 3) / 4);
	const result = new Uint8Array(outputLength);
	let resultOffset = 0;

	for (let i = 0; i < numChunks; i++) {
		const start = i * alignedChunkSize;
		const end = Math.min(start + alignedChunkSize, total);
		let chunk = input.slice(start, end);

		// Only the final chunk may need padding
		if (i === numChunks - 1) {
			while (chunk.length % 4 !== 0) {
				chunk += '=';
			}
		}

		const decodedChunk = decodeBase64(chunk);
		result.set(decodedChunk, resultOffset);
		resultOffset += decodedChunk.length;

		processedBytes += end - start;
		if (onProgress) {
			onProgress(processedBytes, total);
		}

		// Yield to the event loop so the UI / worker can stay responsive
		await new Promise((resolve) => setTimeout(resolve, 0));
	}

	// Trim to the actual decoded length (padding may cause over-allocation)
	return result.slice(0, resultOffset);
}
