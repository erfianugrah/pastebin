import { z } from 'zod';
import { Paste, PasteId, Visibility, VisibilityEnum } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { ExpirationService } from '../../domain/services/expirationService';
import { UniqueIdService } from '../../domain/services/uniqueIdService';

// Using Zod 4 schema definition
export const CreatePasteSchema = z.object({
  content: z.string().min(1).max(25 * 1024 * 1024), // Max 25MiB (Cloudflare KV value limit)
  title: z.string().max(100).optional(),
  language: z.string().optional(),
  expiration: z.number().positive().default(86400), // Default 1 day
  visibility: VisibilityEnum.default('public'),
  password: z.string().max(100).optional(), // Presence triggers client-side encryption
  burnAfterReading: z.boolean().default(false),
  isEncrypted: z.boolean().default(false), // Whether the content is already encrypted client-side
  viewLimit: z.number().int().min(1).max(100).optional(), // Optional view limit
  version: z.number().int().min(0).max(10).optional().default(0), // Encryption version (0=plaintext, 1=server-side, 2=client-side)
});

export type CreatePasteParams = z.infer<typeof CreatePasteSchema>;

export interface CreatePasteResult {
  id: string;
  url: string;
  expiresAt: string;
  deleteToken: string;
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
    
    // Ensure isEncrypted is set correctly
    if (validParams.password) {
      // If a password is provided, content must be encrypted
      validParams.isEncrypted = true;
    }
    
    // Only use version 2+ for actual encrypted content
    if (validParams.isEncrypted) {
      // For encrypted content, use at least version 2 (client-side encryption)
      validParams.version = Math.max(2, validParams.version || 0);
    } else {
      // For unencrypted content, use version 0
      validParams.version = 0;
    }
    
    // Create paste entity
    const paste = Paste.create(
      id,
      validParams.content,
      expirationPolicy,
      validParams.title,
      validParams.language,
      validParams.visibility,
      validParams.burnAfterReading,
      validParams.isEncrypted,
      validParams.viewLimit,
      validParams.version,
    );
    
    // Save to repository
    await this.repository.save(paste);
    
    // Return result (includes deleteToken so the creator can delete their paste)
    return {
      id: id.toString(),
      url: `${this.baseUrl}/pastes/${id.toString()}`,
      expiresAt: paste.getExpiresAt().toISOString(),
      deleteToken: paste.getDeleteToken()!,
    };
  }
}
