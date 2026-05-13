import { z } from 'zod';
import { PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';

// Using Zod 4 schema definition
export const DeletePasteSchema = z.object({
	id: z.string(),
	ownerToken: z.string().optional(),
});

export type DeletePasteParams = z.infer<typeof DeletePasteSchema>;

/** Structured error codes so callers never match on raw message strings. */
export enum DeleteErrorCode {
	NOT_FOUND = 'not_found',
	UNAUTHORIZED = 'unauthorized',
	FAILED = 'delete_failed',
}

export interface DeletePasteResult {
	success: boolean;
	errorCode?: DeleteErrorCode;
	message: string;
}

export class DeletePasteCommand {
	constructor(private readonly repository: PasteRepository) {}

	async execute(params: DeletePasteParams): Promise<DeletePasteResult> {
		// Validate input
		const validParams = DeletePasteSchema.parse(params);

		// Owner token is required for authorisation. Empty/missing token
		// can short-circuit without touching the DB.
		const pasteId = PasteId.create(validParams.id);
		if (!validParams.ownerToken) {
			return {
				success: false,
				errorCode: DeleteErrorCode.UNAUTHORIZED,
				message: 'Unauthorized',
			};
		}

		// Single-statement atomic delete-with-token (Postgres RPC).
		// `delete_paste(uuid, uuid)` takes a row lock, compares the stored
		// `delete_token` against the supplied token, and deletes only on
		// match. Two booleans in the response distinguish the three
		// outcomes (not found / unauthorized / success) so the API layer
		// can map them to 404 / 403 / 200 with one round-trip on the
		// happy path. See supabase/migrations/20260513170000.
		const { found, deleted } = await this.repository.deleteWithToken(pasteId, validParams.ownerToken);

		if (deleted) {
			return {
				success: true,
				message: 'Paste deleted successfully',
			};
		}

		if (!found) {
			return {
				success: false,
				errorCode: DeleteErrorCode.NOT_FOUND,
				message: 'Paste not found',
			};
		}

		// Found but not deleted = token mismatch.
		return {
			success: false,
			errorCode: DeleteErrorCode.UNAUTHORIZED,
			message: 'Unauthorized',
		};
	}
}
