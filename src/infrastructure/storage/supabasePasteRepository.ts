import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Paste, PasteData, PasteId } from '../../domain/models/paste';
import { PasteRepository, ViewResult } from '../../domain/repositories/pasteRepository';
import { PasteFactory } from '../../application/factories/pasteFactory';
import { Logger } from '../logging/logger';

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
		// Server-side client — disable session management (Supabase recommended
		// pattern for non-browser contexts). The Worker uses a secret key which
		// doesn't need refresh; persistSession would try to use localStorage
		// (unavailable in Workers) and autoRefreshToken would set a setTimeout
		// that does nothing useful.
		this.client = createClient(url, key, {
			auth: {
				autoRefreshToken: false,
				persistSession: false,
				detectSessionInUrl: false,
			},
		});
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
			this.logger.error('Supabase: saveSlug failed', { slug, pasteId, error });
			throw new Error(`Failed to save slug: ${error.message}`);
		}
	}

	// Maps Postgres snake_case columns to PasteData camelCase fields
	private mapRow(row: Record<string, unknown>): PasteData {
		return {
			id: row.id as string,
			content: row.content as string,
			title: row.title as string | undefined,
			language: row.language as string | undefined,
			createdAt: row.created_at as string,
			expiresAt: row.expires_at as string,
			visibility: row.visibility as 'public' | 'private',
			burnAfterReading: row.burn_after_reading as boolean,
			readCount: row.read_count as number,
			isEncrypted: row.is_encrypted as boolean,
			viewLimit: row.view_limit as number | undefined,
			version: row.version as number,
			deleteToken: row.delete_token as string | undefined,
			userId: (row.user_id as string | null | undefined) ?? undefined,
		};
	}
}
