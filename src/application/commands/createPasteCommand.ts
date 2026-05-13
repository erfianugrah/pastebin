import { z } from 'zod';
import { Paste, VisibilityEnum } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { ExpirationService } from '../../domain/services/expirationService';
import { UniqueIdService } from '../../domain/services/uniqueIdService';
import { AppError } from '../../infrastructure/errors/AppError';
import { SlugTakenError } from '../../infrastructure/storage/supabasePasteRepository';

// Using Zod 4 schema definition
//
// Vanity slug rules (DNS-label-style):
//   - 3 to 64 characters total
//   - lowercase ASCII letters, digits, hyphens
//   - must start and end with an alphanumeric (no leading/trailing hyphen)
//   - no consecutive hyphens (`a--b` rejected) — keeps slugs readable and
//     prevents homograph-style trickery with double-hyphen separators.
const SlugSchema = z
	.string()
	.min(3)
	.max(64)
	.regex(/^[a-z0-9](?:-?[a-z0-9])*$/, 'Slug must be lowercase alphanumeric with single hyphens between characters');

export const CreatePasteSchema = z.object({
	content: z
		.string()
		.min(1)
		.max(25 * 1024 * 1024), // Max 25MiB (Cloudflare KV value limit)
	title: z.string().max(100).optional(),
	// Concatenated into the `search_vector` generated tsvector + GIN-indexed.
	// Cap to avoid index bloat from arbitrary user input.
	language: z.string().max(50).optional(),
	expiration: z.number().positive().default(86400), // Default 1 day
	visibility: VisibilityEnum.default('public'),
	// `password` is intentionally NOT accepted here. Client-side encryption
	// uses the password only in the browser to derive a key; the server
	// never needs it. Clients signal "this content is encrypted" via
	// `isEncrypted: true` below.
	burnAfterReading: z.boolean().default(false),
	isEncrypted: z.boolean().default(false), // Whether the content is already encrypted client-side
	viewLimit: z.number().int().min(1).max(100).optional(), // Optional view limit
	version: z.number().int().min(0).max(10).optional().default(0), // Encryption version (0=plaintext, 1=server-side, 2=client-side)
	slug: SlugSchema.optional(), // Optional vanity URL slug
});

export type CreatePasteParams = z.infer<typeof CreatePasteSchema>;

export interface CreatePasteResult {
	id: string;
	url: string;
	slug?: string;
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

	async execute(params: CreatePasteParams, opts: { userId?: string } = {}): Promise<CreatePasteResult> {
		// Validate input
		const validParams = CreatePasteSchema.parse(params);

		// Generate a unique ID
		const id = await this.idService.generateId();

		// Create expiration policy
		const expirationPolicy = this.expirationService.createFromSeconds(validParams.expiration);

		// Only use version 2+ for actual encrypted content
		if (validParams.isEncrypted) {
			// For encrypted content, use at least version 2 (client-side encryption)
			validParams.version = Math.max(2, validParams.version || 0);
		} else {
			// For unencrypted content, use version 0
			validParams.version = 0;
		}

		// Create paste entity. userId comes from the auth context (verified JWT
		// in the handler layer); never from the request body to prevent
		// impersonation.
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
			undefined, // deleteToken auto-generated
			opts.userId,
		);

		// Save to repository
		await this.repository.save(paste);

		// Register vanity slug if provided. Two concurrent creates with the
		// same slug can both pass the resolveSlug precheck — saveSlug catches
		// the 23505 unique-violation race-loser case and throws SlugTakenError,
		// which we translate to AppError(409, 'slug_taken') here so the API
		// boundary gets a structured error instead of a raw 500.
		if (validParams.slug) {
			const slugTaken = await this.repository.resolveSlug(validParams.slug);
			if (slugTaken) {
				throw new AppError('slug_taken', 'This custom URL is already taken', 409);
			}
			try {
				await this.repository.saveSlug(validParams.slug, id.toString(), paste.getExpiresAt());
			} catch (err) {
				if (err instanceof SlugTakenError) {
					throw new AppError('slug_taken', 'This custom URL is already taken', 409);
				}
				throw err;
			}
		}

		const slug = validParams.slug;
		const url = slug
			? `${this.baseUrl}/p/${slug}`
			: `${this.baseUrl}/pastes/${id.toString()}`;

		// Return result (includes deleteToken so the creator can delete their paste)
		return {
			id: id.toString(),
			url,
			slug,
			expiresAt: paste.getExpiresAt().toISOString(),
			deleteToken: paste.getDeleteToken()!,
		};
	}
}
