import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { Logger } from '../../infrastructure/logging/logger';

interface SearchResultDTO {
	id: string;
	title: string;
	language: string | null;
	createdAt: string;
	expiresAt: string;
	readCount: number;
}

/**
 * Full-text search across public pastes. Mirrors GetRecentPastesQuery's
 * shape so the frontend can drop search results into the same list UI.
 */
export class SearchPastesQuery {
	constructor(
		private readonly pasteRepository: PasteRepository,
		private readonly logger?: Logger,
	) {}

	async execute(query: string, limit = 20): Promise<SearchResultDTO[]> {
		this.logger?.debug('Executing searchPastes query', { query, limit });

		const pastes = await this.pasteRepository.searchPublic(query, limit);

		return pastes.map((p) => ({
			id: p.getId().toString(),
			title: p.getTitle() || 'Untitled Paste',
			language: p.getLanguage() || null,
			createdAt: p.getCreatedAt().toISOString(),
			expiresAt: p.getExpiresAt().toISOString(),
			readCount: p.getReadCount(),
		}));
	}
}
