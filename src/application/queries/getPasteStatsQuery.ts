import { PasteRepository, PasteStats } from '../../domain/repositories/pasteRepository';
import { Logger } from '../../infrastructure/logging/logger';

/**
 * Aggregate stats over non-expired public pastes. Returns null only if the
 * backing repository cannot compute aggregates.
 *
 * Delegates entirely to the repository -- there's no application-layer
 * shaping. The Postgres function does everything in one round-trip.
 */
export class GetPasteStatsQuery {
	constructor(
		private readonly pasteRepository: PasteRepository,
		private readonly logger?: Logger,
	) {}

	async execute(): Promise<PasteStats | null> {
		this.logger?.debug('Executing getPasteStats query');
		return this.pasteRepository.getPublicStats();
	}
}
