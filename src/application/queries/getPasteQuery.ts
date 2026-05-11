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
	 * Atomicity depends on the storage backend:
	 *  - Supabase: uses the `view_paste()` Postgres function with FOR UPDATE
	 *    row lock. Concurrent reads serialize on the lock -- burn-after-
	 *    reading is exactly-once even under high concurrency.
	 *  - KV: best-effort. The SELECT/UPDATE/DELETE sequence is not atomic
	 *    so concurrent reads can race (documented in KVPasteRepository.view).
	 *
	 * Orchestration is delegated to the repository -- the application layer
	 * doesn't know whether the storage layer is locking rows or not.
	 */
	async execute(id: string): Promise<Paste | null> {
		const pasteId = PasteId.create(id);
		const result = await this.repository.view(pasteId);
		return result.paste;
	}

	/**
	 * Same as execute() but returns derived metadata alongside the paste.
	 * Used by `handlers.handleGetPaste` to decide whether to return the
	 * E2E-encrypted-content branch vs the plain content branch.
	 *
	 * Returns null if the paste was not found / expired / burned / view-limited.
	 */
	async executeSummary(id: string): Promise<{
		paste: Paste;
		isE2EEncrypted: boolean;
	} | null> {
		const paste = await this.execute(id);
		if (!paste) return null;

		const isE2EEncrypted = paste.getIsEncrypted() && paste.getVersion() >= 2;

		return { paste, isE2EEncrypted };
	}
}
