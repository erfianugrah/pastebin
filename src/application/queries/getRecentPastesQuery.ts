import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { Logger } from '../../infrastructure/logging/logger';

interface RecentPasteDTO {
	id: string;
	// null for encrypted pastes — their title is either ciphertext (v3) or
	// withheld (v2) so it never leaks via the public listing. The frontend
	// renders a lock placeholder when isEncrypted is true.
	title: string | null;
	language: string | null;
	createdAt: string;
	expiresAt: string;
	readCount: number;
	isEncrypted: boolean;
}

export class GetRecentPastesQuery {
	constructor(
		private readonly pasteRepository: PasteRepository,
		private readonly logger?: Logger,
	) {}

	async execute(limit: number = 10): Promise<RecentPasteDTO[]> {
		this.logger?.debug('Executing getRecentPastes query', { limit });

		const pastes = await this.pasteRepository.findRecentPublic(limit);

		this.logger?.debug('Retrieved recent pastes from repository', {
			count: pastes.length,
			pasteIds: pastes.map((p) => p.getId().toString()),
		});

		// Map to DTOs (Data Transfer Objects) with only the needed properties.
		// Encrypted pastes withhold title + language so no metadata leaks into
		// the public listing (matches the search_vector exclusion).
		const dtos = pastes.map((paste) => {
			const isEncrypted = paste.getIsEncrypted();
			return {
				id: paste.getId().toString(),
				title: isEncrypted ? null : paste.getTitle() || 'Untitled Paste',
				language: isEncrypted ? null : paste.getLanguage() || null,
				createdAt: paste.getCreatedAt().toISOString(),
				expiresAt: paste.getExpiresAt().toISOString(),
				readCount: paste.getReadCount(),
				isEncrypted,
			};
		});

		this.logger?.debug('Returning recent paste DTOs', { count: dtos.length });

		return dtos;
	}
}
