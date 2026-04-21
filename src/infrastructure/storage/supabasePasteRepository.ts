import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Paste, PasteData, PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { PasteFactory } from '../../application/factories/pasteFactory';
import { Logger } from '../logging/logger';

export class SupabasePasteRepository implements PasteRepository {
	private readonly client: SupabaseClient;
	constructor(
		url: string,
		key: string,
		private readonly logger: Logger,
	) {
		this.client = createClient(url, key);
	}
	async save(paste: Paste): Promise<void> {
		const id = paste.getId().toString();
		const data = paste.toJSON(true);
		this.logger.debug('Saving paste', { pasteId: id });
		const { error } = await this.client.from('pastes').insert({
			id: data.id,
			content: data.content,
			title: data.title,
			language: data.language,
			created_at: data.createdAt,
			expires_at: data.expiresAt,
			visibility: data.visibility,
			burn_after_reading: data.burnAfterReading,
			is_encrypted: data.isEncrypted,
			view_limit: data.viewLimit,
			version: data.version,
			read_count: data.readCount,
			delete_token: data.deleteToken,
		});

		if (error) {
			this.logger.error('Error inserting paste data', {
				pasteId: id,
				error,
			});
			throw new Error(`Failed to save paste: ${error.message}`);
		}
	}
	async findById(id: PasteId): Promise<Paste | null> { this.logger.debug('Finding paste', { pasteId: id.toString() });
		const { data, error } = await this.client.from('pastes').select().eq('id', id.toString()).single();

		if (error) {
			this.logger.error('Error finding paste data', {
				pasteId: id
				error,
			});
			return null;
		}
		if (!data) {
			this.logger.debug('Paste not found', { pasteId: id.toString() });
			return null;
		}

	}
}
