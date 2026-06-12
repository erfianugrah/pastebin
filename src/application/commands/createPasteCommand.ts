import { z } from 'zod';
import { Paste, VisibilityEnum } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { ExpirationService } from '../../domain/services/expirationService';
import { UniqueIdService } from '../../domain/services/uniqueIdService';
import { AppError } from '../../infrastructure/errors/AppError';

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

// 25 MiB UTF-8 ceiling. The Worker isolate has a ~128 MiB memory budget,
// so this is a real DoS bound, not a storage limit (the old KV 25 MiB
// value cap is gone post-Supabase-migration). z.string().max() counts
// UTF-16 code units, NOT bytes — a CJK/emoji paste is up to 3× its
// code-unit count in UTF-8 — so we enforce real bytes via refine. The
// `.max()` stays as a cheap upper guard (bytes >= code units always, so
// it never rejects a valid ≤cap-byte payload) and a fast `length * 3`
// check skips the encode pass except in the narrow 1–3× boundary zone.
const MAX_CONTENT_BYTES = 25 * 1024 * 1024;

export const CreatePasteSchema = z.object({
	content: z
		.string()
		.min(1)
		.max(MAX_CONTENT_BYTES)
		.refine(
			(s) => s.length * 3 <= MAX_CONTENT_BYTES || new TextEncoder().encode(s).length <= MAX_CONTENT_BYTES,
			{ message: `content exceeds ${MAX_CONTENT_BYTES} bytes (UTF-8)` },
		),
	title: z.string().max(100).optional(),
	// Concatenated into the `search_vector` generated tsvector + GIN-indexed.
	// Cap to avoid index bloat from arbitrary user input.
	language: z.string().max(50).optional(),
	// Seconds-to-live. Must be a positive integer, capped at 10 years
	// (matches ExpirationService.createNever()). Without the `.int().max()`
	// an attacker-supplied value like 1e300 overflows the JS Date range:
	// `Date.setSeconds(now + 1e300)` yields an Invalid Date and
	// `getExpiresAt().toISOString()` throws RangeError → unhandled 500 on a
	// single request field.
	expiration: z.number().int().positive().max(315360000).default(86400), // Default 1 day, cap 10y
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

		// Slug precheck BEFORE save: kills the common "already taken" case for
		// free, so we never persist an orphan paste when the slug is plainly
		// unavailable. resolveSlug only matches LIVE (non-expired) rows.
		if (validParams.slug) {
			const slugTaken = await this.repository.resolveSlug(validParams.slug);
			if (slugTaken) {
				throw new AppError('slug_taken', 'This custom URL is already taken', 409);
			}
		}

		// Save to repository
		await this.repository.save(paste);

		// Claim the vanity slug AFTER save (the row must exist for the FK).
		// claimSlug is atomic + expired-row-tolerant: it returns false only when
		// a LIVE row already holds the slug — i.e. a concurrent create slipped
		// past the precheck (TOCTOU). In that race-loser case we compensate by
		// deleting the just-saved paste so we don't accumulate orphans with no
		// reachable URL, then surface a structured 409.
		if (validParams.slug) {
			const claimed = await this.repository.claimSlug(validParams.slug, id.toString(), paste.getExpiresAt());
			if (!claimed) {
				await this.repository.delete(id).catch(() => undefined);
				throw new AppError('slug_taken', 'This custom URL is already taken', 409);
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
