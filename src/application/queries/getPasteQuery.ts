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
    
    // If view limit already exceeded, drop the paste
    if (paste.hasViewLimit() && paste.hasReachedViewLimit()) {
      await this.repository.delete(paste.getId());
      return null;
    }

    // Increment read count for every successful view
    const updatedPaste = paste.incrementReadCount();
    await this.repository.save(updatedPaste);

    // Burn-after-reading: delete immediately after first view
    if (updatedPaste.isBurnAfterReading()) {
      await this.repository.delete(updatedPaste.getId());
      return updatedPaste;
    }

    // If this view reached the view limit, schedule deletion
    if (updatedPaste.hasViewLimit() && updatedPaste.hasReachedViewLimit()) {
      setTimeout(async () => {
        await this.repository.delete(updatedPaste.getId());
      }, 1000);
    }

    return updatedPaste;
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
    const isE2EEncrypted = paste.getIsEncrypted() && paste.getVersion() >= 2;
    
    return { 
      paste, 
      requiresPassword,
      isE2EEncrypted
    };
  }
}
