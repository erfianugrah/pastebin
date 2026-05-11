import { Paste, PasteId } from '../../domain/models/paste';
import { PasteRepository, ViewResult } from '../../domain/repositories/pasteRepository';
import { Logger } from '../logging/logger';

/**
 * Dual-write repository for Phase 1 migration.
 *
 * Writes to both primary (KV) and secondary (Supabase).
 * All reads come from primary -- KV remains source of truth.
 *
 * Secondary failures are logged but never propagate -- KV is still
 * authoritative. This lets us verify Supabase is receiving data correctly
 * before trusting it with reads in Phase 2.
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
		// secondary's read_count diverges, which is acceptable in Phase 1
		// (it gets reconciled on the next save()).
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
