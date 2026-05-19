import { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { Paste, PasteData, PasteId } from '../../domain/models/paste';
import { PasteRepository, PasteStats, ViewResult } from '../../domain/repositories/pasteRepository';
import { PasteFactory } from '../../application/factories/pasteFactory';
import { Logger } from '../logging/logger';
import { getServiceRoleClient } from '../supabase/getSupabaseClient';

// Zod schema for the raw row shape Postgres delivers (snake_case columns).
// Runs at the storage boundary so a Supabase schema drift surfaces as a
// loud `RepositoryShapeError` here rather than 50 stack frames deeper
// when, say, `ExpirationPolicy.create(NaN)` throws because `created_at`
// arrived as undefined.
//
// `.passthrough()` keeps extra columns (e.g. `updated_at`, generated
// `search_vector`) — we don't model them, but we don't want the validation
// to reject the row just because Supabase added a column.
const PasteRowSchema = z
	.object({
		id: z.string(),
		content: z.string(),
		title: z.string().nullable().optional(),
		language: z.string().nullable().optional(),
		created_at: z.string(),
		expires_at: z.string(),
		visibility: z.enum(['public', 'private']),
		burn_after_reading: z.boolean(),
		read_count: z.number().int().nonnegative(),
		is_encrypted: z.boolean(),
		view_limit: z.number().int().positive().nullable().optional(),
		version: z.number().int().nonnegative(),
		delete_token: z.string().nullable().optional(),
		user_id: z.string().nullable().optional(),
	})
	.passthrough();

type PasteRow = z.infer<typeof PasteRowSchema>;

/** Thrown when a Supabase row doesn't conform to the expected shape. */
export class RepositoryShapeError extends Error {
	readonly code = 'repository_shape_error';
	constructor(message: string, public readonly issues: unknown) {
		super(message);
		this.name = 'RepositoryShapeError';
		Object.setPrototypeOf(this, RepositoryShapeError.prototype);
	}
}

// Shape of the view_paste() RPC response. Postgres returns 0 or 1 row.
interface ViewPasteRow {
	paste_data: Record<string, unknown> | null;
	was_burned: boolean;
	was_view_limited: boolean;
}

export class SupabasePasteRepository implements PasteRepository {
	private readonly client: SupabaseClient;

	constructor(
		url: string,
		key: string, // sb_secret_... key -- bypasses RLS
		private readonly logger: Logger,
	) {
		// Shared service-role client (cached by (url, key) in
		// getSupabaseClient.ts). `persistSession: false` + `autoRefreshToken:
		// false` means the client carries no per-request state, so caching
		// across the V8 isolate is safe.
		this.client = getServiceRoleClient(url, key);
	}

	async save(paste: Paste): Promise<void> {
		const id = paste.getId().toString();
		const data = paste.toJSON(true); // true = include deleteToken

		this.logger.debug('Supabase: saving paste', { pasteId: id });

		// upsert not insert -- save() is called for both creates AND updates
		// (e.g. read count increments, content edits)
		const { error } = await this.client.from('pastes').upsert({
			id: data.id,
			content: data.content,
			title: data.title,
			language: data.language,
			created_at: data.createdAt,
			expires_at: data.expiresAt,
			visibility: data.visibility,
			burn_after_reading: data.burnAfterReading,
			read_count: data.readCount,
			is_encrypted: data.isEncrypted,
			view_limit: data.viewLimit,
			version: data.version,
			delete_token: data.deleteToken,
			user_id: data.userId ?? null,
			// updated_at is handled by the set_updated_at trigger
		});

		if (error) {
			this.logger.error('Supabase: save failed', { pasteId: id, error });
			throw new Error(`Failed to save paste: ${error.message}`);
		}
	}

	async findById(id: PasteId): Promise<Paste | null> {
		this.logger.debug('Supabase: finding paste', { pasteId: id.toString() });

		const { data, error } = await this.client
			.from('pastes')
			.select('*')
			.eq('id', id.toString())
			.single();

		if (error) {
			// PGRST116 = no rows found -- not a real error
			if (error.code === 'PGRST116') {
				this.logger.debug('Supabase: paste not found', { pasteId: id.toString() });
				return null;
			}
			this.logger.error('Supabase: findById failed', { pasteId: id.toString(), error });
			return null;
		}

		if (!data) return null;

		return PasteFactory.fromData(this.mapRow(data));
	}

	async view(id: PasteId): Promise<ViewResult> {
		this.logger.debug('Supabase: viewing paste (atomic)', { pasteId: id.toString() });

		// view_paste() takes a row lock with FOR UPDATE, handles read-count
		// increment + burn-after-reading + view-limit atomically. See
		// supabase/migrations/20260511130427_add_view_paste_rpc.sql for the
		// PL/pgSQL implementation and race-condition rationale.
		const { data, error } = await this.client.rpc('view_paste', {
			paste_uuid: id.toString(),
		});

		if (error) {
			this.logger.error('Supabase: view_paste RPC failed', {
				pasteId: id.toString(),
				error,
			});
			return { paste: null, wasBurned: false, wasViewLimited: false };
		}

		// RPC returns an array of 0 or 1 rows. 0 = not found, expired, or
		// already-at-view-limit (DB cleaned it up).
		const rows = (data ?? []) as ViewPasteRow[];
		if (rows.length === 0 || !rows[0].paste_data) {
			return { paste: null, wasBurned: false, wasViewLimited: false };
		}

		const row = rows[0];
		const paste = PasteFactory.fromData(this.mapRow(row.paste_data!));

		return {
			paste,
			wasBurned: row.was_burned,
			wasViewLimited: row.was_view_limited,
		};
	}

	async delete(id: PasteId): Promise<boolean> {
		this.logger.debug('Supabase: deleting paste', { pasteId: id.toString() });

		const { error, count } = await this.client
			.from('pastes')
			.delete({ count: 'exact' })
			.eq('id', id.toString());

		if (error) {
			this.logger.error('Supabase: delete failed', { pasteId: id.toString(), error });
			return false;
		}

		return (count ?? 0) > 0;
	}

	async deleteWithToken(id: PasteId, ownerToken: string): Promise<{ found: boolean; deleted: boolean }> {
		this.logger.debug('Supabase: delete_paste RPC', { pasteId: id.toString() });

		const { data, error } = await this.client.rpc('delete_paste', {
			paste_uuid: id.toString(),
			owner_token: ownerToken,
		});

		if (error) {
			// 22P02 (invalid_text_representation) = the token wasn't a valid
			// UUID. Treat the same as not-found from the caller's perspective
			// — they supplied a token that couldn't possibly match.
			if (error.code === '22P02') {
				return { found: false, deleted: false };
			}
			this.logger.error('Supabase: delete_paste RPC failed', { pasteId: id.toString(), error });
			return { found: false, deleted: false };
		}

		// RPC returns one row of {was_found, was_deleted}. Defend against an
		// empty array (shouldn't happen but supabase-js typing is loose).
		const rows = (data ?? []) as Array<{ was_found: boolean; was_deleted: boolean }>;
		if (rows.length === 0) {
			return { found: false, deleted: false };
		}
		const row = rows[0];
		return { found: row.was_found, deleted: row.was_deleted };
	}

	async updateWithToken(
		id: PasteId,
		ownerToken: string,
		fields: { content?: string | null; title?: string | null; language?: string | null },
	): Promise<{ found: boolean; updated: boolean }> {
		this.logger.debug('Supabase: update_paste RPC', { pasteId: id.toString() });

		const { data, error } = await this.client.rpc('update_paste', {
			paste_uuid: id.toString(),
			owner_token: ownerToken,
			// supabase-js sends `null` over the wire as JSON null, which
			// reaches the SQL function as Postgres NULL and is handled by the
			// COALESCE in the RPC (means "leave column unchanged").
			new_content: fields.content ?? null,
			new_title: fields.title ?? null,
			new_language: fields.language ?? null,
		});

		if (error) {
			// 22P02 = invalid_text_representation. Caller supplied a token
			// that wasn't a UUID; treat as not-found for the same reason as
			// deleteWithToken (no oracle on token presence vs format).
			if (error.code === '22P02') {
				return { found: false, updated: false };
			}
			this.logger.error('Supabase: update_paste RPC failed', { pasteId: id.toString(), error });
			return { found: false, updated: false };
		}

		const rows = (data ?? []) as Array<{ was_found: boolean; was_updated: boolean }>;
		if (rows.length === 0) {
			return { found: false, updated: false };
		}
		const row = rows[0];
		return { found: row.was_found, updated: row.was_updated };
	}

	async searchPublic(query: string, limit: number): Promise<Paste[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];

		this.logger.debug('Supabase: searching public pastes', { query: trimmed, limit });

		// .textSearch translates to `column @@ websearch_to_tsquery(config, query)`.
		// 'english' config matches what the search_vector generated column uses,
		// so stemming aligns on both sides.
		const { data, error } = await this.client
			.from('pastes')
			.select('*')
			.eq('visibility', 'public')
			.gt('expires_at', new Date().toISOString())
			.textSearch('search_vector', trimmed, { type: 'websearch', config: 'english' })
			.order('created_at', { ascending: false })
			.limit(limit);

		if (error) {
			this.logger.error('Supabase: searchPublic failed', { query: trimmed, error });
			return [];
		}

		return (data ?? []).map((row) => PasteFactory.fromData(this.mapRow(row)));
	}

	async findRecentPublic(limit: number): Promise<Paste[]> {
		this.logger.debug('Supabase: finding recent public pastes', { limit });

		const { data, error } = await this.client
			.from('pastes')
			.select('*')
			.eq('visibility', 'public')
			.gt('expires_at', new Date().toISOString())
			.order('created_at', { ascending: false })
			.limit(limit);

		if (error) {
			this.logger.error('Supabase: findRecentPublic failed', { error });
			return [];
		}

		return (data ?? []).map((row) => PasteFactory.fromData(this.mapRow(row)));
	}

	async getPublicStats(): Promise<PasteStats | null> {
		this.logger.debug('Supabase: getting paste_stats()');

		const { data, error } = await this.client.rpc('paste_stats');

		if (error) {
			this.logger.error('Supabase: paste_stats RPC failed', { error });
			return null;
		}

		// The function returns a single jsonb object; supabase-js delivers
		// that as the `data` value directly (not wrapped in an array).
		if (!data || typeof data !== 'object') return null;

		return data as PasteStats;
	}

	async resolveSlug(slug: string): Promise<string | null> {
		const { data, error } = await this.client
			.from('slugs')
			.select('paste_id')
			.eq('slug', slug)
			.gt('expires_at', new Date().toISOString())
			.single();

		if (error || !data) return null;

		return data.paste_id;
	}

	async saveSlug(slug: string, pasteId: string, expiresAt: Date): Promise<void> {
		const { error } = await this.client.from('slugs').insert({
			slug,
			paste_id: pasteId,
			expires_at: expiresAt.toISOString(),
		});

		if (error) {
			// Postgres unique_violation when another request inserted the same
			// slug between our resolveSlug() check and this insert (TOCTOU).
			// Surface as a typed conflict so the API layer can return 409
			// without leaking the raw Postgres error message.
			if (error.code === '23505') {
				throw new SlugTakenError(slug);
			}
			this.logger.error('Supabase: saveSlug failed', { slug, pasteId, error });
			throw new Error(`Failed to save slug: ${error.message}`);
		}
	}

	// Maps Postgres snake_case columns to PasteData camelCase fields.
	// Runs every row through `PasteRowSchema` first so schema drift, RLS-
	// stripped columns, or partial selects surface as a typed error here
	// rather than producing a half-constructed Paste that explodes deep
	// inside the domain layer.
	private mapRow(row: Record<string, unknown>): PasteData {
		const parsed = PasteRowSchema.safeParse(row);
		if (!parsed.success) {
			this.logger.error('Supabase: paste row shape mismatch', {
				issues: parsed.error.issues,
			});
			throw new RepositoryShapeError('Paste row does not match expected shape', parsed.error.issues);
		}
		const r: PasteRow = parsed.data;
		return {
			id: r.id,
			content: r.content,
			title: r.title ?? undefined,
			language: r.language ?? undefined,
			createdAt: r.created_at,
			expiresAt: r.expires_at,
			visibility: r.visibility,
			burnAfterReading: r.burn_after_reading,
			readCount: r.read_count,
			isEncrypted: r.is_encrypted,
			viewLimit: r.view_limit ?? undefined,
			version: r.version,
			deleteToken: r.delete_token ?? undefined,
			userId: r.user_id ?? undefined,
		};
	}
}

/**
 * Thrown by saveSlug() when the unique constraint on `slugs.slug` is hit —
 * either because two concurrent createPaste requests passed the resolveSlug
 * precheck (TOCTOU) or because resolveSlug missed for any reason. Translated
 * to HTTP 409 at the API boundary.
 */
export class SlugTakenError extends Error {
	readonly code = 'slug_taken';
	constructor(public readonly slug: string) {
		super(`Slug '${slug}' is already taken`);
		this.name = 'SlugTakenError';
		Object.setPrototypeOf(this, SlugTakenError.prototype);
	}
}
