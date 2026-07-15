/**
 * Contract types for the live /recent Realtime relay (feat/realtime-recent-do).
 *
 * PARENT-OWNED contract file: the loop implements phoenixClient.ts / feedHub.ts
 * / recentFeedDurableObject.ts against these types + the conformance tests in
 * src/tests/infrastructure/realtime/. Do not widen these to make an impl pass.
 *
 * See docs/plans/2026-07-14-realtime-recent-do.md.
 */

/**
 * The safe paste metadata broadcast on the `recent:public` channel. Mirrors
 * the shape of `GET /api/recent` (see the SQL trigger
 * broadcast_public_paste_insert()). NEVER carries content, delete_token, or
 * user_id.
 */
export interface PasteCreatedMeta {
	id: string;
	title: string;
	language: string | null;
	createdAt: string;
	expiresAt: string | null;
	readCount: number;
	isEncrypted: boolean;
	version: number;
}

/** The frame the DO sends to browser clients over the same-origin socket. */
export interface RecentLiveMessage {
	type: 'paste_created';
	paste: PasteCreatedMeta;
}

/**
 * Minimal WebSocket surface used by the client + hub. Both a browser
 * WebSocket and a Cloudflare outbound WebSocket satisfy this.
 */
export interface WsLike {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	readonly readyState: number;
	addEventListener(
		type: 'open' | 'message' | 'close' | 'error',
		listener: (event: { data?: unknown; code?: number; reason?: string }) => void,
	): void;
}

/** WebSocket.OPEN readyState value. */
export const WS_OPEN = 1;

/** Injected side-effects so the client is deterministic under test. */
export interface PhoenixClientDeps {
	/** Open the upstream WS to the given wss:// URL. */
	connect(url: string): WsLike;
	setTimeout(handler: () => void, ms: number): number;
	clearTimeout(id: number): void;
	/** Current epoch ms - used as the `broadcast.replay.since` cursor. */
	now(): number;
}

export type PhoenixStatus = 'connecting' | 'joined' | 'closed' | 'error';

export interface PhoenixClientConfig {
	/** e.g. https://<ref>.supabase.co */
	supabaseUrl: string;
	/** anon / publishable JWT (role=anon). Server-side only. */
	anonKey: string;
	/** channel topic without the `realtime:` prefix, e.g. `recent:public`. */
	topic: string;
	/** user event name to surface, e.g. `paste_created`. */
	event: string;
	/** called for each matching broadcast. */
	onPaste(meta: PasteCreatedMeta): void;
	/** optional lifecycle observer. */
	onStatusChange?(status: PhoenixStatus): void;
	/** max messages to replay on rejoin (default 50). */
	replayLimit?: number;
}

/** The upstream Supabase Realtime client the DO holds. */
export interface PhoenixClient {
	start(): void;
	stop(): void;
}

/** Fan-out registry of browser sockets. */
export interface FeedHub {
	add(ws: WsLike): void;
	remove(ws: WsLike): void;
	/** send a paste_created frame to every open socket; prune closed ones. */
	broadcast(meta: PasteCreatedMeta): void;
	size(): number;
}
