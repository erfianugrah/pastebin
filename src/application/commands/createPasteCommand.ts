import { z } from 'zod';
import { Paste, PasteId, Visibility, VisibilityEnum } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { ExpirationService } from '../../domain/services/expirationService';
import { UniqueIdService } from '../../domain/services/uniqueIdService';

export const CreatePasteSchema = z.object({
  content: z.string().min(1).max(1024 * 1024), // Max 1MB
  title: z.string().max(100).optional(),
  language: z.string().optional(),
  expiration: z.number().positive().default(86400), // Default 1 day
  visibility: VisibilityEnum.default('public'),
  password: z.string().max(100).optional(),
  burnAfterReading: z.boolean().default(false),
});

export type CreatePasteParams = z.infer<typeof CreatePasteSchema>;

export interface CreatePasteResult {
  id: string;
  url: string;
  expiresAt: string;
}

export class CreatePasteCommand {
  constructor(
    private readonly repository: PasteRepository,
    private readonly idService: UniqueIdService,
    private readonly expirationService: ExpirationService,
    private readonly baseUrl: string,
  ) {}

  async execute(params: CreatePasteParams): Promise<CreatePasteResult> {
    // Validate input
    const validParams = CreatePasteSchema.parse(params);
    
    // Generate a unique ID
    const id = await this.idService.generateId();
    
    // Create expiration policy
    const expirationPolicy = this.expirationService.createFromSeconds(
      validParams.expiration,
    );
    
    // Hash the password if provided using WebCrypto API
    let passwordHash: string | undefined;
    if (validParams.password) {
      const encoder = new TextEncoder();
      const data = encoder.encode(validParams.password);
      
      // Use SHA-256 algorithm
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      
      // Convert buffer to hex string
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    // Create paste entity
    const paste = Paste.create(
      id,
      validParams.content,
      expirationPolicy,
      validParams.title,
      validParams.language,
      validParams.visibility,
      passwordHash,
      validParams.burnAfterReading,
    );
    
    // Save to repository
    await this.repository.save(paste);
    
    // Return result
    return {
      id: id.toString(),
      url: `${this.baseUrl}/pastes/${id.toString()}`,
      expiresAt: paste.getExpiresAt().toISOString(),
    };
  }
}
