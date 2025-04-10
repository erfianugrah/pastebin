import { PasteId } from '../../domain/models/paste';
import { UniqueIdService } from '../../domain/services/uniqueIdService';

export class CloudflareUniqueIdService implements UniqueIdService {
  /**
   * Generate a new unique ID for a paste using Crypto.randomUUID()
   * @returns A promise that resolves to a unique ID
   */
  async generateId(): Promise<PasteId> {
    // Generate a random UUID
    const uuid = crypto.randomUUID();
    
    // Extract a shorter ID from the UUID (first 8 chars)
    const shortId = uuid.split('-')[0];
    
    return PasteId.create(shortId);
  }
}
