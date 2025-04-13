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
    
    // Handle view limits
    if (paste.hasViewLimit() && paste.hasReachedViewLimit()) {
      // Paste has reached its view limit, delete it
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
    
    // Check if this view will reach the view limit
    if (paste.hasViewLimit() && paste.getReadCount() + 1 >= (paste.getViewLimit() as number)) {
      // This is the last allowed view, create a final copy before updating the readCount
      const finalCopy = paste;
      
      // Increment the read count on the original (which will reach/exceed the limit)
      const updatedPaste = paste.incrementReadCount();
      
      // Save the updated read count
      await this.repository.save(updatedPaste);
      
      // Schedule deletion for after the response is sent
      setTimeout(async () => {
        await this.repository.delete(paste.getId());
      }, 1000);
      
      // Return the final copy for this last view
      return finalCopy;
    }
    
    return paste;
  }
  
  /**
   * Get paste summary without content (for listing and access control)
   */
  async executeSummary(id: string): Promise<{ 
    paste: Paste, 
    requiresPassword: boolean, 
    isE2EEncrypted: boolean 
  } | null> {
    const paste = await this.execute(id);
    
    if (!paste) {
      return null;
    }
    
    // Phase 4: All security is client-side E2E encryption
    
    // Server-side passwords are completely removed in Phase 4
    const requiresPassword = false;
    
    // All pastes are either unencrypted or use client-side E2E encryption
    const isE2EEncrypted = paste.getIsEncrypted() || paste.getVersion() >= 2;
    
    return { 
      paste, 
      requiresPassword,
      isE2EEncrypted
    };
  }
}
