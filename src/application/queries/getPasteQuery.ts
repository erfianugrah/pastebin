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
      // Make a copy of the paste for return before deletion
      const pasteCopy = paste;
      
      // Delete the paste immediately after reading
      await this.repository.delete(paste.getId());
      
      // Return the paste for this single view
      return pasteCopy;
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
