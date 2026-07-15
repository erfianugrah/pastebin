import type { FeedHub, PasteCreatedMeta, RecentLiveMessage, WsLike } from './contract';
import { WS_OPEN } from './contract';

/**
 * Fan-out registry of browser sockets held by the Durable Object. Pure logic
 * (no CF runtime) so it is unit-testable in plain vitest.
 *
 * `broadcast` serialises a single `paste_created` frame and sends it to every
 * socket whose readyState is OPEN, pruning any socket that is no longer open.
 */
export function createFeedHub(): FeedHub {
	const sockets = new Set<WsLike>();

	return {
		add(ws: WsLike): void {
			sockets.add(ws);
		},
		remove(ws: WsLike): void {
			sockets.delete(ws);
		},
		broadcast(meta: PasteCreatedMeta): void {
			const message: RecentLiveMessage = { type: 'paste_created', paste: meta };
			const frame = JSON.stringify(message);
			for (const ws of [...sockets]) {
				if (ws.readyState === WS_OPEN) {
					ws.send(frame);
				} else {
					sockets.delete(ws);
				}
			}
		},
		size(): number {
			return sockets.size;
		},
	};
}
