import { Paste, PasteData, PasteId, Visibility } from '../../domain/models/paste';
import { ExpirationPolicy } from '../../domain/models/paste';

export class PasteFactory {
  /**
   * Create a Paste entity from raw data
   * @param data The raw paste data
   * @returns A Paste entity
   */
  static fromData(data: PasteData): Paste {
    const id = PasteId.create(data.id);
    const createdAt = new Date(data.createdAt);
    const expiresAt = new Date(data.expiresAt);
    
    // Calculate expiration in seconds
    const expirationSeconds = Math.floor(
      (expiresAt.getTime() - createdAt.getTime()) / 1000
    );
    
    const expirationPolicy = ExpirationPolicy.create(expirationSeconds);
    
    return new Paste(
      id,
      data.content,
      createdAt,
      expirationPolicy,
      data.title,
      data.language,
      data.visibility,
      data.burnAfterReading || false,
      data.readCount || 0,
      data.isEncrypted || false,
      data.viewLimit,
      data.version || 0
    );
  }
}
