import { Paste, PasteId } from '../../domain/models/paste';
import { PasteRepository, ViewResult } from '../../domain/repositories/pasteRepository';
import { Logger } from '../logging/logger';

/**
 * Shadow-write repository: forwards every write to a primary AND a
 * secondary backend, but reads only from the primary. Secondary write
 * failures are logged, never thrown.
 *
 * Originally introduced for the KV -> Supabase migration (Phase 1):
 * primary = KV, secondary = Supabase. Activated via STORAGE_BACKEND=dual.
 *
 * Currently inactive in production (STORAGE_BACKEND=supabase). Retained
 * because it's the right escape hatch for any future "verify writes land
 * in a new backend before trusting reads" workflow. Scheduled for removal
 * in Phase 5 if no longer needed.
 */
export class DualWriteRepository implements PasteRepository {
	constructor(
		private readonly primary: PasteRepository,   // KV -- reads come from here
		private readonly secondary: PasteRepository, // Supabase -- shadow writes
		private readonly logger: Logger,
	) {}

	async save(paste: Paste): Promise<void> {
		// Primary write must succeed
		await this.primary.save(paste);

		// Secondary write is best-effort
		try {
			await this.secondary.save(paste);
		} catch (error) {
			this.logger.error('DualWrite: secondary save failed (non-fatal)', {
				pasteId: paste.getId().toString(),
				error,
			});
		}
	}

	async delete(id: PasteId): Promise<boolean> {
		// Primary delete is authoritative
		const result = await this.primary.delete(id);

		// Secondary delete is best-effort
		try {
			await this.secondary.delete(id);
		} catch (error) {
			this.logger.error('DualWrite: secondary delete failed (non-fatal)', {
				pasteId: id.toString(),
				error,
			});
		}

		return result;
	}

	async saveSlug(slug: string, pasteId: string, expiresAt: Date): Promise<void> {
		await this.primary.saveSlug(slug, pasteId, expiresAt);

		try {
			await this.secondary.saveSlug(slug, pasteId, expiresAt);
		} catch (error) {
			this.logger.error('DualWrite: secondary saveSlug failed (non-fatal)', {
				slug,
				pasteId,
				error,
			});
		}
	}

	// All reads from primary only
	async findById(id: PasteId) {
		return this.primary.findById(id);
	}

	async view(id: PasteId): Promise<ViewResult> {
		// view() has side effects (read_count++, possible burn/delete) -- only
		// the primary is authoritative. Don't shadow-view to secondary: that
		// would double-count reads and could burn the paste twice. The
		// secondary's read_count may diverge, which is acceptable -- it gets
		// reconciled on the next save().
		return this.primary.view(id);
	}

	async findRecentPublic(limit: number) {
		return this.primary.findRecentPublic(limit);
	}

	async searchPublic(query: string, limit: number) {
		return this.primary.searchPublic(query, limit);
	}

	async resolveSlug(slug: string) {
		return this.primary.resolveSlug(slug);
	}
}
