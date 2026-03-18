import { PasteId } from '../../domain/models/paste';
import { UniqueIdService } from '../../domain/services/uniqueIdService';

/**
 * Generate a UUIDv7 (time-ordered, RFC 9562).
 *
 * Layout (128 bits):
 *   48 bits  unix_ts_ms
 *    4 bits  version  (0111)
 *   12 bits  rand_a
 *    2 bits  variant  (10)
 *   62 bits  rand_b
 *
 * UUIDv7 IDs are naturally sortable by creation time and have ~74 bits of
 * randomness, giving a collision probability of ~1 in 2^74 even within the
 * same millisecond.
 */
function generateUUIDv7(): string {
	const timestamp = Date.now();

	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);

	// Write 48-bit timestamp into bytes 0-5
	const view = new DataView(bytes.buffer);
	view.setUint32(0, Math.floor(timestamp / 0x10000)); // upper 32 of 48 bits
	view.setUint16(4, timestamp & 0xffff); // lower 16 of 48 bits

	// Set version nibble to 7 (bits 48-51)
	bytes[6] = (bytes[6] & 0x0f) | 0x70;

	// Set variant to RFC 4122 (bits 64-65: 10xx)
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	// Format as canonical UUID string
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export class CloudflareUniqueIdService implements UniqueIdService {
	/**
	 * Generate a new unique UUIDv7 ID for a paste.
	 */
	async generateId(): Promise<PasteId> {
		return PasteId.create(generateUUIDv7());
	}
}
