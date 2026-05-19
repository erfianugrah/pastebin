import { z } from 'zod';
import { PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';

// 25 MiB — same cap as CreatePasteSchema.content. The Worker's runtime
// memory budget (~128 MiB on Cloudflare Workers) makes this the
// effective ceiling; without it a token-holding attacker could DoS the
// isolate with a single multi-hundred-MB payload through PUT.
const MAX_CONTENT_BYTES = 25 * 1024 * 1024;

/**
 * Schema for `PUT /pastes/:id`. The token is REQUIRED (carries owner
 * authorisation); content/title/language are each OPTIONAL with NULL
 * semantics = "leave column unchanged" (passed verbatim to the
 * `update_paste` RPC's COALESCE branch).
 *
 * Fields NOT acceptable here on purpose:
 *   - visibility / burnAfterReading / viewLimit / version / isEncrypted
 *     — changing these mid-life would invalidate the security model
 *     (e.g. flipping burn off after the paste has been read once, or
 *     downgrading encryption version). If a user needs different
 *     semantics, they create a new paste.
 *   - read_count — owned by `view_paste` RPC, never the user.
 *   - expiration / expires_at — would let token-holders extend pastes
 *     indefinitely; current rule is "expiry is set at create time".
 *   - delete_token — rotating the token isn't supported.
 *   - userId — set at create time from the verified JWT.
 *
 * The Zod schema runs at the handler boundary so the DB never sees
 * non-string content or arbitrarily-large payloads.
 */
export const UpdatePasteSchema = z.object({
	token: z.string().uuid({ message: 'token must be a UUID' }),
	content: z.string().min(1).max(MAX_CONTENT_BYTES).optional(),
	title: z.string().max(100).optional(),
	language: z.string().max(50).optional(),
});

export type UpdatePasteParams = z.infer<typeof UpdatePasteSchema>;

export enum UpdateErrorCode {
	NOT_FOUND = 'not_found',
	UNAUTHORIZED = 'unauthorized',
	FAILED = 'update_failed',
}

export interface UpdatePasteResult {
	success: boolean;
	errorCode?: UpdateErrorCode;
	message: string;
}

export class UpdatePasteCommand {
	constructor(private readonly repository: PasteRepository) {}

	async execute(pasteId: string, params: UpdatePasteParams): Promise<UpdatePasteResult> {
		// Zod parse here re-validates (handler also parses, but we treat the
		// command as a defensive boundary in case it's called from another
		// caller in the future).
		const valid = UpdatePasteSchema.parse(params);
		const id = PasteId.create(pasteId);

		const { found, updated } = await this.repository.updateWithToken(id, valid.token, {
			content: valid.content,
			title: valid.title,
			language: valid.language,
		});

		if (updated) {
			return { success: true, message: 'Paste updated' };
		}

		if (!found) {
			return {
				success: false,
				errorCode: UpdateErrorCode.NOT_FOUND,
				message: 'Paste not found',
			};
		}

		return {
			success: false,
			errorCode: UpdateErrorCode.UNAUTHORIZED,
			message: 'Unauthorized',
		};
	}
}
