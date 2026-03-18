import { Paste, PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';

export class GetPasteQuery {
	constructor(private readonly repository: PasteRepository) {}

	/**
	 * Read-only fetch of a paste without incrementing read count or triggering side effects.
	 * Use this for internal lookups where a "view" should not be recorded.
	 */
	async findById(id: string): Promise<Paste | null> {
		const pasteId = PasteId.create(id);
		return this.repository.findById(pasteId);
	}

	/**
	 * Fetch a paste, increment its read count, and enforce burn-after-reading
	 * and view-limit policies.
	 *
	 * **Concurrency caveat:** Cloudflare KV is eventually-consistent, so
	 * concurrent requests may each read the *same* readCount before either
	 * write lands. This means burn-after-reading pastes could be served to
	 * more than one simultaneous viewer, and view-limited pastes may slightly
	 * exceed their limit. For stronger guarantees, consider Durable Objects
	 * with an input gate for the critical section.
	 */
	async execute(id: string): Promise<Paste | null> {
		const pasteId = PasteId.create(id);
		const paste = await this.repository.findById(pasteId);

		if (!paste) {
			return null;
		}

		// Check if paste has expired
		if (paste.hasExpired()) {
			// Delete expired paste
			await this.repository.delete(paste.getId());
			return null;
		}

		// If view limit already exceeded, drop the paste
		if (paste.hasViewLimit() && paste.hasReachedViewLimit()) {
			await this.repository.delete(paste.getId());
			return null;
		}

		// Increment read count for every successful view
		const updatedPaste = paste.incrementReadCount();
		await this.repository.save(updatedPaste);

		// Burn-after-reading: delete immediately after first view
		if (updatedPaste.isBurnAfterReading()) {
			await this.repository.delete(updatedPaste.getId());
			return updatedPaste;
		}

		// If this view reached the view limit, delete immediately
		if (updatedPaste.hasViewLimit() && updatedPaste.hasReachedViewLimit()) {
			await this.repository.delete(updatedPaste.getId());
		}

		return updatedPaste;
	}

	/**
	 * Get paste summary without content (for listing and access control)
	 */
	async executeSummary(id: string): Promise<{
		paste: Paste;
		requiresPassword: boolean;
		isE2EEncrypted: boolean;
	} | null> {
		const paste = await this.execute(id);

		if (!paste) {
			return null;
		}

		// Phase 4: All security is client-side E2E encryption

		// Server-side passwords are completely removed in Phase 4
		const requiresPassword = false;

		// All pastes are either unencrypted or use client-side E2E encryption
		const isE2EEncrypted = paste.getIsEncrypted() && paste.getVersion() >= 2;

		return {
			paste,
			requiresPassword,
			isE2EEncrypted,
		};
	}
}
