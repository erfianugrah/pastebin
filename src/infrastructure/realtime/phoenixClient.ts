import type { PasteCreatedMeta, PhoenixClient, PhoenixClientConfig, PhoenixClientDeps, WsLike } from './contract';

/** Heartbeat cadence. Supabase Realtime disconnects idle sockets; keep <=25s. */
const HEARTBEAT_MS = 25_000;
/** Reconnect backoff ladder (ms). Clamps at the last entry. */
const BACKOFF_MS = [1000, 2000, 5000, 10000];

/**
 * A minimal Supabase Realtime client speaking the Phoenix v1.0.0 JSON
 * protocol over an injected WebSocket-like transport. Deterministic under
 * test: all side effects (connect, timers) come through `deps`.
 *
 * Lifecycle:
 *   start() -> connect -> on open: phx_join (private channel) + heartbeat loop
 *   on phx_reply(ok): onStatusChange('joined')
 *   on broadcast(event === config.event): onPaste(payload.payload)
 *   on phx_error / ws close: reconnect after a backoff (never synchronously)
 *   stop(): close ws, cancel timers, prevent any further reconnect
 */
export function createPhoenixClient(config: PhoenixClientConfig, deps: PhoenixClientDeps): PhoenixClient {
	let ws: WsLike | null = null;
	let stopped = false;
	let refCounter = 0;
	let joinRef = '';
	let heartbeatTimer: number | null = null;
	let reconnectTimer: number | null = null;
	let reconnectAttempt = 0;

	function buildUrl(): string {
		const base = config.supabaseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:').replace(/\/$/, '');
		return `${base}/realtime/v1/websocket?apikey=${config.anonKey}&vsn=1.0.0`;
	}

	function nextRef(): string {
		return String(++refCounter);
	}

	function clearTimers(): void {
		if (heartbeatTimer !== null) {
			deps.clearTimeout(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (reconnectTimer !== null) {
			deps.clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	function scheduleHeartbeat(): void {
		if (heartbeatTimer !== null) deps.clearTimeout(heartbeatTimer);
		heartbeatTimer = deps.setTimeout(() => {
			heartbeatTimer = null;
			if (stopped || !ws) return;
			ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }));
			scheduleHeartbeat();
		}, HEARTBEAT_MS);
	}

	function scheduleReconnect(): void {
		if (stopped || reconnectTimer !== null) return;
		const delay = BACKOFF_MS[Math.min(reconnectAttempt, BACKOFF_MS.length - 1)];
		reconnectAttempt++;
		reconnectTimer = deps.setTimeout(() => {
			reconnectTimer = null;
			if (stopped) return;
			connect();
		}, delay);
	}

	function handleMessage(raw: unknown): void {
		if (typeof raw !== 'string') return;
		let frame: any;
		try {
			frame = JSON.parse(raw);
		} catch {
			return;
		}

		if (frame.event === 'phx_reply') {
			if (frame.payload?.status === 'ok') {
				config.onStatusChange?.('joined');
			} else {
				config.onStatusChange?.('error');
				scheduleReconnect();
			}
			return;
		}

		if (frame.event === 'phx_error' || frame.event === 'phx_close') {
			config.onStatusChange?.('error');
			scheduleReconnect();
			return;
		}

		if (frame.event === 'broadcast' && frame.payload?.event === config.event) {
			config.onPaste(frame.payload.payload as PasteCreatedMeta);
		}
	}

	function connect(): void {
		if (stopped) return;
		config.onStatusChange?.('connecting');
		ws = deps.connect(buildUrl());

		ws.addEventListener('open', () => {
			if (stopped || !ws) return;
			joinRef = nextRef();
			ws.send(
				JSON.stringify({
					topic: `realtime:${config.topic}`,
					event: 'phx_join',
					payload: {
						config: {
							broadcast: { ack: false, self: false },
							presence: { enabled: false },
							private: true,
						},
						access_token: config.anonKey,
					},
					ref: joinRef,
					join_ref: joinRef,
				}),
			);
			scheduleHeartbeat();
		});

		ws.addEventListener('message', (event) => {
			if (stopped) return;
			handleMessage(event.data);
		});

		ws.addEventListener('close', () => {
			if (stopped) return;
			if (heartbeatTimer !== null) {
				deps.clearTimeout(heartbeatTimer);
				heartbeatTimer = null;
			}
			config.onStatusChange?.('closed');
			scheduleReconnect();
		});

		ws.addEventListener('error', () => {
			if (stopped) return;
			config.onStatusChange?.('error');
			scheduleReconnect();
		});
	}

	return {
		start(): void {
			stopped = false;
			reconnectAttempt = 0;
			connect();
		},
		stop(): void {
			stopped = true;
			clearTimers();
			if (ws) {
				try {
					ws.close();
				} catch {
					/* already closed */
				}
				ws = null;
			}
		},
	};
}
