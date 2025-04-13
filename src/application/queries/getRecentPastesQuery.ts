import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { Paste } from '../../domain/models/paste';

interface RecentPasteDTO {
  id: string;
  title: string;
  language: string | null;
  createdAt: string;
  expiresAt: string;
  readCount: number;
}

export class GetRecentPastesQuery {
  constructor(
    private readonly pasteRepository: PasteRepository,
  ) {}

  async execute(limit: number = 10): Promise<RecentPasteDTO[]> {
    const pastes = await this.pasteRepository.findRecentPublic(limit);
    
    // Map to DTOs (Data Transfer Objects) with only the needed properties
    return pastes.map(paste => ({
      id: paste.getId().toString(),
      title: paste.getTitle() || 'Untitled Paste',
      language: paste.getLanguage() || null,
      createdAt: paste.getCreatedAt().toISOString(),
      expiresAt: paste.getExpiresAt().toISOString(),
      readCount: paste.getReadCount()
    }));
  }
}