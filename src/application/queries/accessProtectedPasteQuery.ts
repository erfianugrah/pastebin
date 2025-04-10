import { z } from 'zod';
import { Paste, PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';

export const AccessProtectedPasteSchema = z.object({
  id: z.string(),
  password: z.string(),
});

export type AccessProtectedPasteParams = z.infer<typeof AccessProtectedPasteSchema>;

export class AccessProtectedPasteQuery {
  constructor(private readonly repository: PasteRepository) {}

  async execute(params: AccessProtectedPasteParams): Promise<Paste | null> {
    const validParams = AccessProtectedPasteSchema.parse(params);
    
    const pasteId = PasteId.create(validParams.id);
    const paste = await this.repository.findById(pasteId);
    
    // Check if paste exists
    if (!paste) {
      return null;
    }
    
    // Check if paste has expired
    if (paste.hasExpired()) {
      // Delete expired paste
      await this.repository.delete(paste.getId());
      return null;
    }
    
    // If paste has no password protection or password is correct, return the paste
    if (!paste.hasPassword()) {
      return paste;
    }
    
    // Check password asynchronously
    const isPasswordCorrect = await paste.isPasswordCorrect(validParams.password);
    if (isPasswordCorrect) {
      return paste;
    }
    
    // Password incorrect
    return null;
  }
}