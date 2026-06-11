/**
 * Tests for the crypto functions.
 *
 * Format/version notes (see crypto-shared.ts):
 *   - encryptData() always writes the version-4 format: length-padded
 *     plaintext, Argon2id for password mode.
 *   - decryptData(..., version) selects the KDF + whether to strip padding.
 *     version >= 4 -> Argon2id + unpad; version <= 3 -> PBKDF2 + no unpad
 *     (legacy, kept forever so old pastes keep decrypting).
 *
 * Argon2id runs for real here (hash-wasm, works in node) — it does NOT use
 * crypto.subtle, so the subtle mock below only affects the legacy-PBKDF2
 * backward-compat path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nacl from 'tweetnacl';
import { generateEncryptionKey, encryptData, decryptData, deriveKeyFromPassword } from './crypto';
import { encodeBase64, deriveKeyPBKDF2, SALT_LENGTH, PAD_BLOCK, CRYPTO_VERSION_ARGON2_PADDED } from './crypto-shared';

const V4 = CRYPTO_VERSION_ARGON2_PADDED;

// Mock Web Worker that immediately errors, forcing the main-thread fallback
// (the worker path itself is not exercisable under vitest).
class MockWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	constructor() {
		setTimeout(() => {
			this.onerror?.(new ErrorEvent('error', { message: 'Mock Worker Error', error: new Error('Mock Worker Error') }));
		}, 0);
	}
	postMessage() {}
}

describe('Crypto utilities', () => {
	const originalWindow = global.window;

	beforeEach(() => {
		global.window = { ...originalWindow, Worker: MockWorker as any } as any;

		// Deterministic getRandomValues + a fake-but-deterministic PBKDF2
		// (used only by the legacy backward-compat path).
		Object.defineProperty(global, 'crypto', {
			value: {
				getRandomValues: (array: Uint8Array) => {
					for (let i = 0; i < array.length; i++) array[i] = i % 256;
					return array;
				},
				subtle: {
					importKey: vi.fn().mockResolvedValue('mockKey'),
					deriveBits: vi.fn().mockImplementation((params: { salt: Uint8Array }) => {
						const saltSum = params.salt.reduce((acc, val) => acc + val, 0);
						const derivedKey = new Uint8Array(32);
						for (let i = 0; i < derivedKey.length; i++) derivedKey[i] = (saltSum + i) % 256;
						return Promise.resolve(derivedKey.buffer);
					}),
				},
			},
			configurable: true,
		});

		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		global.window = originalWindow;
		vi.restoreAllMocks();
	});

	describe('generateEncryptionKey', () => {
		it('generates a base64 key of the correct length', () => {
			const key = generateEncryptionKey();
			expect(typeof key).toBe('string');
			expect(key.length).toBeGreaterThanOrEqual(42);
			expect(key.length).toBeLessThanOrEqual(46);
		});

		it('generates unique keys each time', () => {
			expect(generateEncryptionKey()).not.toEqual(generateEncryptionKey());
		});
	});

	describe('encryptData / decryptData (version 4)', () => {
		it('round-trips with a random key', async () => {
			const original = 'This is a test message to be encrypted';
			const key = generateEncryptionKey();
			const encrypted = await encryptData(original, key);
			expect(typeof encrypted).toBe('string');
			const decrypted = await decryptData(encrypted, key, false, V4);
			expect(decrypted).toBe(original);
		});

		it('round-trips with an Argon2id password-derived key', async () => {
			const original = 'This is a test message encrypted with a password';
			const password = 'test-password-123';
			const { key, salt } = await deriveKeyFromPassword(password);
			const encrypted = await encryptData(original, key, true, salt);
			const decrypted = await decryptData(encrypted, password, true, V4);
			expect(decrypted).toBe(original);
		});

		it('fails to decrypt with the wrong key', async () => {
			const encrypted = await encryptData('secret', generateEncryptionKey());
			await expect(decryptData(encrypted, generateEncryptionKey(), false, V4)).rejects.toThrow();
		});

		it('fails to decrypt password data with the wrong password', async () => {
			const { key, salt } = await deriveKeyFromPassword('correct-horse');
			const encrypted = await encryptData('secret', key, true, salt);
			await expect(decryptData(encrypted, 'wrong-password', true, V4)).rejects.toThrow();
		});

		it('round-trips large data', async () => {
			const large = 'A'.repeat(20000);
			const key = generateEncryptionKey();
			const encrypted = await encryptData(large, key);
			expect(await decryptData(encrypted, key, false, V4)).toBe(large);
		});

		it('round-trips empty and unicode content', async () => {
			const key = generateEncryptionKey();
			for (const s of ['', 'a', '🔒🗝️ émojî and ünïcode', 'x'.repeat(PAD_BLOCK)]) {
				const enc = await encryptData(s, key);
				expect(await decryptData(enc, key, false, V4)).toBe(s);
			}
		});
	});

	describe('length-padding hides plaintext length', () => {
		it('produces identical ciphertext length for differently-sized short secrets', async () => {
			const key = generateEncryptionKey();
			// Both well under one PAD_BLOCK (minus the 4-byte length prefix).
			const a = await encryptData('hi', key);
			const b = await encryptData('a much longer but still sub-block secret value', key);
			expect(a.length).toBe(b.length);
		});

		it('grows by one bucket when crossing a block boundary', async () => {
			const key = generateEncryptionKey();
			const small = await encryptData('x'.repeat(10), key);
			const big = await encryptData('x'.repeat(PAD_BLOCK + 10), key);
			expect(big.length).toBeGreaterThan(small.length);
		});
	});

	describe('backward compatibility (legacy version 2, PBKDF2, unpadded)', () => {
		it('decrypts a legacy password blob with version 2', async () => {
			// Build a pre-v4 blob by hand: PBKDF2 key, NO padding, [salt|nonce|ct].
			const password = 'legacy-password';
			const salt = new Uint8Array(SALT_LENGTH).fill(3);
			const legacyKey = await deriveKeyPBKDF2(password, salt);
			const message = new TextEncoder().encode('legacy plaintext content');
			const nonce = new Uint8Array(nacl.secretbox.nonceLength).fill(9);
			const ct = nacl.secretbox(message, nonce, legacyKey);

			const blob = new Uint8Array(salt.length + nonce.length + ct.length);
			blob.set(salt);
			blob.set(nonce, salt.length);
			blob.set(ct, salt.length + nonce.length);

			// version 2 -> PBKDF2 (no Argon2), no unpadding.
			const out = await decryptData(encodeBase64(blob), password, true, 2);
			expect(out).toBe('legacy plaintext content');
		});

		it('decrypts a legacy key-mode blob with version 0', async () => {
			const key = new Uint8Array(32).fill(5);
			const message = new TextEncoder().encode('legacy key-mode content');
			const nonce = new Uint8Array(nacl.secretbox.nonceLength).fill(2);
			const ct = nacl.secretbox(message, nonce, key);
			const blob = new Uint8Array(nonce.length + ct.length);
			blob.set(nonce);
			blob.set(ct, nonce.length);

			const out = await decryptData(encodeBase64(blob), encodeBase64(key), false, 0);
			expect(out).toBe('legacy key-mode content');
		});
	});

	describe('deriveKeyFromPassword (Argon2id)', () => {
		const saltA = encodeBase64(new Uint8Array(SALT_LENGTH).fill(1));
		const saltB = encodeBase64(new Uint8Array(SALT_LENGTH).fill(2));

		it('derives identical keys from the same password and salt', async () => {
			const { key: k1 } = await deriveKeyFromPassword('pw', saltA);
			const { key: k2 } = await deriveKeyFromPassword('pw', saltA);
			expect(k1).toBe(k2);
		});

		it('derives different keys from the same password with different salts', async () => {
			const { key: k1 } = await deriveKeyFromPassword('pw', saltA);
			const { key: k2 } = await deriveKeyFromPassword('pw', saltB);
			expect(k1).not.toBe(k2);
		});

		it('derives different keys from different passwords with the same salt', async () => {
			const { key: k1 } = await deriveKeyFromPassword('password-one', saltA);
			const { key: k2 } = await deriveKeyFromPassword('password-two', saltA);
			expect(k1).not.toBe(k2);
		});

		it('falls back gracefully when the worker fails', async () => {
			const result = await deriveKeyFromPassword('test-password');
			expect(typeof result.key).toBe('string');
			expect(typeof result.salt).toBe('string');
		});
	});

	describe('server-side rendering compatibility', () => {
		beforeEach(() => {
			global.window = undefined as any;
		});

		it('derives a key in SSR', async () => {
			const result = await deriveKeyFromPassword('ssr-test-password');
			expect(result).toHaveProperty('key');
			expect(result).toHaveProperty('salt');
		});

		it('round-trips encryption in SSR', async () => {
			const data = 'SSR encryption round-trip';
			const key = generateEncryptionKey();
			const encrypted = await encryptData(data, key);
			expect(await decryptData(encrypted, key, false, V4)).toBe(data);
		});
	});
});
