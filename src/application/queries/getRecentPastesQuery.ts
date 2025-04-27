import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { Paste } from '../../domain/models/paste';
import { Logger } from '../../infrastructure/logging/logger';

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
    private readonly logger?: Logger,
  ) {}

  async execute(limit: number = 10): Promise<RecentPasteDTO[]> {
    this.logger?.debug('Executing getRecentPastes query', { limit });
    
    const pastes = await this.pasteRepository.findRecentPublic(limit);
    
    this.logger?.debug('Retrieved recent pastes from repository', { 
      count: pastes.length,
      pasteIds: pastes.map(p => p.getId().toString())
    });
    
    // Map to DTOs (Data Transfer Objects) with only the needed properties
    const dtos = pastes.map(paste => ({
      id: paste.getId().toString(),
      title: paste.getTitle() || 'Untitled Paste',
      language: paste.getLanguage() || null,
      createdAt: paste.getCreatedAt().toISOString(),
      expiresAt: paste.getExpiresAt().toISOString(),
      readCount: paste.getReadCount()
    }));
    
    this.logger?.debug('Returning recent paste DTOs', { count: dtos.length });
    
    return dtos;
  }
}