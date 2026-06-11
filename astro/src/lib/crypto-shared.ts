/**
 * Shared cryptographic constants and utilities used by both the main thread
 * (crypto.ts) and the Web Worker (crypto-worker.ts).
 *
 * Keeping a single source of truth avoids subtle divergence between the two
 * execution contexts.
 */
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { argon2id } from 'hash-wasm';

// Re-export the encode helper as-is
export const { encodeBase64 } = util;

// ---- Constants ----

export const PBKDF2_ITERATIONS = 300000; // High iteration count for better security (legacy v<=3 password mode)
export const SALT_LENGTH = 16; // 16 bytes salt
export const KEY_LENGTH = nacl.secretbox.keyLength; // 32 bytes for NaCl secretbox

// ---- Argon2id parameters (version 4+ password mode) ----
// OWASP first-choice baseline for interactive use: m=19 MiB, t=2, p=1.
// Memory-hard → GPU/ASIC-resistant, unlike PBKDF2-SHA-256. ~100-150ms in
// browser/worker/node. The salt + KDF are selected by the paste `version`
// column on decrypt, so legacy PBKDF2 pastes keep decrypting forever.
export const ARGON2_MEMORY_KIB = 19456; // 19 MiB
export const ARGON2_ITERATIONS = 2;
export const ARGON2_PARALLELISM = 1;

// Encryption format versions (mirror of the DB `version` column):
//   0 = plaintext
//   2 = legacy E2EE (content only, plaintext title, PBKDF2, unpadded)
//   3 = E2EE content + title (PBKDF2, unpadded)
//   4 = E2EE content + title, Argon2id password mode, length-padded
export const CRYPTO_VERSION_ARGON2_PADDED = 4;

// Length-padding block size. Plaintext is padded to a multiple of this so the
// stored ciphertext length only reveals the bucket, not the exact secret
// length. 256 bytes bounds overhead while coarsening the sensitive
// short-secret case to 256-byte granularity.
export const PAD_BLOCK = 256;
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

// ---- Key derivation (single source of truth for main thread + worker) ----

/**
 * Derive a 32-byte key from a password using Argon2id (version 4+).
 * Memory-hard; resists offline GPU brute force on publicly-fetchable
 * ciphertext far better than PBKDF2-SHA-256.
 */
export async function deriveKeyArgon2id(password: string, salt: Uint8Array): Promise<Uint8Array> {
	const key = await argon2id({
		password,
		salt,
		parallelism: ARGON2_PARALLELISM,
		iterations: ARGON2_ITERATIONS,
		memorySize: ARGON2_MEMORY_KIB,
		hashLength: KEY_LENGTH,
		outputType: 'binary',
	});
	return key as Uint8Array;
}

/**
 * Derive a 32-byte key from a password using PBKDF2-SHA-256 (legacy, v<=3).
 * Kept forever so existing password-protected pastes keep decrypting.
 */
export async function deriveKeyPBKDF2(password: string, salt: Uint8Array): Promise<Uint8Array> {
	const passwordBuffer = new TextEncoder().encode(password);
	const passwordKey = await crypto.subtle.importKey('raw', passwordBuffer, { name: 'PBKDF2' }, false, ['deriveBits']);
	const derivedBits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		passwordKey,
		KEY_LENGTH * 8,
	);
	return new Uint8Array(derivedBits);
}

/**
 * Select the KDF by paste version: version >= 4 uses Argon2id, older uses
 * PBKDF2. This is the only place the KDF dispatch lives — main thread and
 * worker both route through it so they cannot diverge.
 */
export async function deriveKeyForVersion(password: string, salt: Uint8Array, version: number): Promise<Uint8Array> {
	return version >= CRYPTO_VERSION_ARGON2_PADDED ? deriveKeyArgon2id(password, salt) : deriveKeyPBKDF2(password, salt);
}

// ---- Length-padding (version 4+) ----

/**
 * Pad a plaintext message to a multiple of PAD_BLOCK. Layout:
 *   [uint32 BE original-length][plaintext][zero padding]
 * secretbox authenticates the whole thing, so the zero padding can't be
 * tampered undetectably. Applied to BOTH key-mode and password-mode blobs.
 */
export function padMessage(message: Uint8Array): Uint8Array {
	const len = message.length;
	const bodyLen = 4 + len;
	const total = Math.ceil(bodyLen / PAD_BLOCK) * PAD_BLOCK;
	const out = new Uint8Array(total);
	out[0] = (len >>> 24) & 0xff;
	out[1] = (len >>> 16) & 0xff;
	out[2] = (len >>> 8) & 0xff;
	out[3] = len & 0xff;
	out.set(message, 4);
	return out;
}

/** Reverse padMessage: read the length prefix and slice off the original bytes. */
export function unpadMessage(padded: Uint8Array): Uint8Array {
	if (padded.length < 4) {
		throw new Error('Invalid padded message: too short');
	}
	const len = ((padded[0] << 24) | (padded[1] << 16) | (padded[2] << 8) | padded[3]) >>> 0;
	if (4 + len > padded.length) {
		throw new Error('Invalid padding: declared length exceeds buffer');
	}
	return padded.slice(4, 4 + len);
}
