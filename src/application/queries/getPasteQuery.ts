import { Paste, PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';

export class GetPasteQuery {
  constructor(private readonly repository: PasteRepository) {}

  async execute(id: string): Promise<Paste | null> {
    const pasteId = PasteId.create(id);
    const paste = await this.repository.findById(pasteId);
    
    if (!paste) {
      return null;
    }
    
    // Check if paste has expired
    if (paste.hasExpired()) {
      // Delete expired paste
      await this.repository.delete(paste.getId());
      return null;
    }
    
    // Handle burn after reading
    if (paste.isBurnAfterReading()) {
      // Increment read count
      const updatedPaste = paste.incrementReadCount();
      
      // If this is the first read, save the updated paste with incremented count
      if (paste.getReadCount() === 0) {
        await this.repository.save(updatedPaste);
        return updatedPaste;
      } else {
        // If it's already been read, delete it
        await this.repository.delete(paste.getId());
        return null;
      }
    }
    
    return paste;
  }
  
  /**
   * Get paste summary without content (for listing and password-protected pastes)
   */
  async executeSummary(id: string): Promise<{ paste: Paste, requiresPassword: boolean } | null> {
    const paste = await this.execute(id);
    
    if (!paste) {
      return null;
    }
    
    // Check if paste is password-protected
    const requiresPassword = paste.hasPassword();
    
    return { 
      paste, 
      requiresPassword 
    };
  }
}
