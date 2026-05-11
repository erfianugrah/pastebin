import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Paste, PasteData, PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { PasteFactory } from '../../application/factories/pasteFactory';
import { Logger } from '../logging/logger';

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
			// updated_at is handled by the set_updated_at trigger
			// user_id is null for anonymous pastes (Phase 4 adds auth)
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
		};
	}
}
