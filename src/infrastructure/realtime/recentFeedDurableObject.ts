import type { Env } from '../../types';
import { createFeedHub } from './feedHub';
import { createPhoenixClient } from './phoenixClient';
import type { FeedHub, PhoenixClient, WsLike } from './contract';

/**
 * Bridges the async CF outbound-WebSocket handshake (fetch -> resp.webSocket ->
 * accept()) onto the synchronous `WsLike` transport the PhoenixClient expects.
 *
 * The client calls `connect(url)` and synchronously registers its listeners;
 * we kick off the handshake in the background and, once the socket is accepted,
 * attach the real socket's events and synthesise an `open` event (accepted CF
 * sockets do not emit one). Sends issued before the socket is ready are
 * buffered and flushed on connect.
 */
class OutboundWs implements WsLike {
	readyState = 0; // CONNECTING
	private socket: WebSocket | null = null;
	private ready = false;
	private queue: string[] = [];
	private listeners: Record<'open' | 'message' | 'close' | 'error', ((e: { data?: unknown; code?: number; reason?: string }) => void)[]> = {
		open: [],
		message: [],
		close: [],
		error: [],
	};

	constructor(url: string) {
		void this.dial(url);
	}

	private async dial(url: string): Promise<void> {
		try {
			// Cloudflare's fetch() upgrade requires an http(s) URL, not ws(s):
			// the phoenixClient builds a wss:// URL (correct for a browser
			// WebSocket, wrong for fetch). Translate the scheme.
			const httpUrl = url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
			const resp = await fetch(httpUrl, { headers: { Upgrade: 'websocket' } });
			const ws = resp.webSocket;
			if (!ws) throw new Error(`upstream response had no webSocket (status ${resp.status})`);
			ws.accept();
			this.socket = ws;
			this.ready = true;
			this.readyState = 1; // OPEN
			ws.addEventListener('message', (e) => this.emit('message', { data: (e as MessageEvent).data }));
			ws.addEventListener('close', (e) => {
				this.readyState = 3;
				this.ready = false;
				this.emit('close', { code: (e as CloseEvent).code, reason: (e as CloseEvent).reason });
			});
			ws.addEventListener('error', () => this.emit('error', {}));
			for (const msg of this.queue) ws.send(msg);
			this.queue = [];
			// Accepted sockets are already open; synthesise the event the
			// PhoenixClient waits on before sending phx_join.
			this.emit('open', {});
		} catch (e) {
			console.error('[RecentFeedDO] upstream dial failed:', (e as Error)?.message ?? String(e));
			this.readyState = 3;
			this.emit('error', {});
			this.emit('close', { code: 1006 });
		}
	}

	send(data: string): void {
		if (this.socket && this.ready) this.socket.send(data);
		else this.queue.push(data);
	}

	close(code?: number, reason?: string): void {
		this.readyState = 3;
		this.ready = false;
		try {
			this.socket?.close(code, reason);
		} catch {
			/* already closed */
		}
	}

	addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (e: { data?: unknown; code?: number; reason?: string }) => void): void {
		this.listeners[type].push(listener);
	}

	private emit(type: 'open' | 'message' | 'close' | 'error', e: { data?: unknown; code?: number; reason?: string }): void {
		for (const cb of this.listeners[type]) cb(e);
	}
}

/**
 * Singleton Durable Object relaying the Supabase Realtime `recent:public`
 * broadcast channel to browser clients over a same-origin WebSocket.
 *
 * BFF invariant: the anon key + Supabase URL live only here (server-side); the
 * browser only ever opens `/api/recent/live` (same origin) and receives curated
 * `paste_created` metadata frames. Nothing about Supabase leaks to the client.
 */
export class RecentFeedDO {
	private ctx: DurableObjectState;
	private env: Env;
	private hub: FeedHub = createFeedHub();
	private phoenix: PhoenixClient | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		this.ctx = ctx;
		this.env = env;
		// Rebuild the fan-out registry after a hibernation wake: the accepted
		// sockets survive, the in-memory hub does not.
		const existing = this.ctx.getWebSockets();
		for (const ws of existing) this.hub.add(ws as unknown as WsLike);
		if (existing.length > 0) this.ensureUpstream();
	}

	async fetch(request: Request): Promise<Response> {
		const upgrade = request.headers.get('Upgrade');
		if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
			return new Response('Expected a WebSocket upgrade', { status: 426 });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];

		// Hibernatable accept: the runtime persists the socket and drives our
		// webSocketClose / webSocketError handlers even across eviction.
		this.ctx.acceptWebSocket(server);
		this.hub.add(server as unknown as WsLike);
		this.ensureUpstream();

		return new Response(null, { status: 101, webSocket: client });
	}

	webSocketClose(ws: WebSocket): void {
		this.hub.remove(ws as unknown as WsLike);
		this.stopUpstreamIfIdle();
	}

	webSocketError(ws: WebSocket): void {
		this.hub.remove(ws as unknown as WsLike);
		this.stopUpstreamIfIdle();
	}

	/** Lazily open the single upstream Supabase Realtime subscription. */
	private ensureUpstream(): void {
		if (this.phoenix) return;
		this.phoenix = createPhoenixClient(
			{
				supabaseUrl: this.env.SUPABASE_URL,
				anonKey: this.env.SUPABASE_ANON_KEY,
				topic: 'recent:public',
				event: 'paste_created',
				onPaste: (meta) => this.hub.broadcast(meta),
				onStatusChange: (s) => { if (s === 'error' || s === 'closed') console.warn('[RecentFeedDO] upstream', s); },
			},
			{
				connect: (url) => new OutboundWs(url),
				setTimeout: (handler, ms) => setTimeout(handler, ms) as unknown as number,
				clearTimeout: (id) => clearTimeout(id),
				now: () => Date.now(),
			},
		);
		this.phoenix.start();
	}

	/** Drop the upstream subscription once no browser clients remain. */
	private stopUpstreamIfIdle(): void {
		if (this.hub.size() === 0 && this.phoenix) {
			this.phoenix.stop();
			this.phoenix = null;
		}
	}
}
