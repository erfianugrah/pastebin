import { z } from 'zod';
import { PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';

// Using Zod 4 schema definition
export const DeletePasteSchema = z.object({
  id: z.string(),
  // Optional owner token for authorization (future enhancement)
  ownerToken: z.string().optional(),
});

export type DeletePasteParams = z.infer<typeof DeletePasteSchema>;

export interface DeletePasteResult {
  success: boolean;
  message: string;
}

export class DeletePasteCommand {
  constructor(
    private readonly repository: PasteRepository,
  ) {}

  async execute(params: DeletePasteParams): Promise<DeletePasteResult> {
    // Validate input
    const validParams = DeletePasteSchema.parse(params);
    
    // Create a paste ID from the string parameter
    const pasteId = PasteId.create(validParams.id);
    
    // Check if the paste exists first
    const paste = await this.repository.findById(pasteId);
    if (!paste) {
      return {
        success: false,
        message: 'Paste not found'
      };
    }
    
    // TODO: In the future, we could implement authorization checks here
    // if (paste.getOwnerToken() !== validParams.ownerToken) {
    //   return {
    //     success: false,
    //     message: 'Unauthorized'
    //   };
    // }
    
    // Delete the paste
    const deleted = await this.repository.delete(pasteId);
    
    if (deleted) {
      return {
        success: true,
        message: 'Paste deleted successfully'
      };
    } else {
      return {
        success: false,
        message: 'Failed to delete paste'
      };
    }
  }
}