import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { Logger } from '../../infrastructure/logging/logger';

interface SearchResultDTO {
	id: string;
	title: string | null;
	language: string | null;
	createdAt: string;
	expiresAt: string;
	readCount: number;
	isEncrypted: boolean;
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

		// Encrypted pastes shouldn't appear in search at all (the search_vector
		// generated column excludes them), but withhold their metadata defensively
		// in case a row is matched via another path.
		return pastes.map((p) => {
			const isEncrypted = p.getIsEncrypted();
			return {
				id: p.getId().toString(),
				title: isEncrypted ? null : p.getTitle() || 'Untitled Paste',
				language: isEncrypted ? null : p.getLanguage() || null,
				createdAt: p.getCreatedAt().toISOString(),
				expiresAt: p.getExpiresAt().toISOString(),
				readCount: p.getReadCount(),
				isEncrypted,
			};
		});
	}
}
