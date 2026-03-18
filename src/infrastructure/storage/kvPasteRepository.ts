import { Paste, PasteData, PasteId } from '../../domain/models/paste';
import { PasteRepository } from '../../domain/repositories/pasteRepository';
import { PasteFactory } from '../../application/factories/pasteFactory';
import { Logger } from '../logging/logger';

export class KVPasteRepository implements PasteRepository {
	constructor(
		private readonly kv: KVNamespace,
		private readonly logger: Logger,
	) {}

	async save(paste: Paste): Promise<void> {
		const id = paste.getId().toString();
		// Pass true to include secrets (deleteToken) in stored data
		const data = paste.toJSON(true);

		this.logger.debug('Saving paste', { pasteId: id });

		// Save to KV with expiration
		const expiresAt = paste.getExpiresAt();
		const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

		await this.kv.put(id, JSON.stringify(data), {
			expirationTtl: ttl,
		});

		// If paste is public, add to recent list
		if (paste.getVisibility() === 'public') {
			await this.addToRecentList(id, expiresAt);
		}
	}

	async findById(id: PasteId): Promise<Paste | null> {
		this.logger.debug('Finding paste', { pasteId: id.toString() });

		const data = await this.kv.get(id.toString());

		if (!data) {
			this.logger.debug('Paste not found', { pasteId: id.toString() });
			return null;
		}

		try {
			const pasteData = JSON.parse(data) as PasteData;
			return PasteFactory.fromData(pasteData);
		} catch (error) {
			this.logger.error('Error parsing paste data', {
				pasteId: id.toString(),
				error,
			});
			return null;
		}
	}

	async delete(id: PasteId): Promise<boolean> {
		this.logger.debug('Deleting paste', { pasteId: id.toString() });

		// First check if paste exists
		const exists = await this.kv.get(id.toString());

		if (!exists) {
			return false;
		}

		await this.kv.delete(id.toString());
		await this.removeFromRecentList(id.toString());

		return true;
	}

	async findRecentPublic(limit: number): Promise<Paste[]> {
		this.logger.debug('Finding recent public pastes', { limit });

		const recentIds = await this.getRecentList(limit);

		// Fetch all pastes in parallel instead of sequentially (N+1 fix)
		const results = await Promise.all(recentIds.map((id) => this.findById(PasteId.create(id))));

		return results.filter((paste): paste is Paste => paste !== null);
	}

	private async addToRecentList(id: string, expiresAt: Date): Promise<void> {
		// Store the ID in a list with timestamp as key for sorting
		const key = `recent:${Date.now()}:${id}`;

		await this.kv.put(key, id, {
			expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
		});
	}

	private async removeFromRecentList(id: string): Promise<void> {
		// Find all keys in the recent list that contain this ID
		let listComplete = false;
		let cursor: string | undefined;
		while (!listComplete) {
			const result = await this.kv.list({ prefix: 'recent:', cursor });

			for (const key of result.keys) {
				if (key.name.endsWith(`:${id}`)) {
					await this.kv.delete(key.name);
				}
			}

			if (result.list_complete) {
				listComplete = true;
			} else {
				cursor = result.cursor;
			}
		}
	}

	private async getRecentList(limit: number): Promise<string[]> {
		// Collect ALL recent keys across pages, then sort globally.
		// KV list() returns keys in ascending lexicographic order, so
		// recent:{timestamp}:{id} keys come back oldest-first. We need
		// newest-first, so we collect everything and reverse.
		const allKeys: { name: string }[] = [];
		let listComplete = false;
		let cursor: string | undefined;

		while (!listComplete) {
			const result = await this.kv.list({
				prefix: 'recent:',
				cursor,
			});

			allKeys.push(...result.keys);

			if (result.list_complete) {
				listComplete = true;
			} else {
				cursor = result.cursor;
			}
		}

		// Sort globally by key name descending (newest first)
		allKeys.sort((a, b) => b.name.localeCompare(a.name));

		// Extract paste IDs from the top `limit` keys
		const pasteIds: string[] = [];
		for (const key of allKeys) {
			if (pasteIds.length >= limit) break;
			const parts = key.name.split(':');
			if (parts.length >= 3) {
				pasteIds.push(parts.slice(2).join(':'));
			}
		}

		return pasteIds;
	}
}
