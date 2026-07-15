import { useEffect, useRef } from 'react';

/**
 * Safe paste metadata pushed over the same-origin live feed. Mirrors the
 * server contract's `PasteCreatedMeta` (see
 * src/infrastructure/realtime/contract.ts) but stays a frontend-local type so
 * the browser bundle never imports anything Worker-side.
 */
export interface LivePaste {
	id: string;
	title?: string | null;
	language?: string | null;
	createdAt: string;
	expiresAt?: string | null;
	readCount: number;
	isEncrypted?: boolean;
	version?: number;
}

interface LiveFrame {
	type?: string;
	paste?: LivePaste;
}

interface UseRecentLiveOptions {
	/** Called for each `paste_created` frame the relay pushes. */
	onPaste: (paste: LivePaste) => void;
	/** Observe connection state so the caller can toggle its poll fallback. */
	onConnectionChange?: (connected: boolean) => void;
	/** Set false to disable the socket entirely (default true). */
	enabled?: boolean;
}

const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000];

/**
 * Subscribe to the live /recent feed over a SAME-ORIGIN WebSocket
 * (`/api/recent/live`). This is the only socket the browser opens: the BFF
 * invariant means it never talks to Supabase directly, so `connect-src 'self'`
 * stays intact. Reconnects with a bounded backoff; the caller keeps its poll
 * as a fallback for when the socket is down.
 */
export function useRecentLive({ onPaste, onConnectionChange, enabled = true }: UseRecentLiveOptions): void {
	const onPasteRef = useRef(onPaste);
	const onConnectionChangeRef = useRef(onConnectionChange);
	onPasteRef.current = onPaste;
	onConnectionChangeRef.current = onConnectionChange;

	useEffect(() => {
		if (!enabled || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;

		let socket: WebSocket | null = null;
		let disposed = false;
		let attempt = 0;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

		const liveUrl = () => {
			const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
			return `${proto}${window.location.host}/api/recent/live`;
		};

		const scheduleReconnect = () => {
			if (disposed || reconnectTimer != null) return;
			const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
			attempt++;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, delay);
		};

		function connect() {
			if (disposed) return;
			let ws: WebSocket;
			try {
				ws = new WebSocket(liveUrl());
			} catch {
				scheduleReconnect();
				return;
			}
			socket = ws;

			ws.addEventListener('open', () => {
				attempt = 0;
				onConnectionChangeRef.current?.(true);
			});
			ws.addEventListener('message', (event) => {
				try {
					const frame = JSON.parse(event.data as string) as LiveFrame;
					if (frame?.type === 'paste_created' && frame.paste) {
						onPasteRef.current(frame.paste);
					}
				} catch {
					/* ignore malformed frames */
				}
			});
			ws.addEventListener('close', () => {
				onConnectionChangeRef.current?.(false);
				if (!disposed) scheduleReconnect();
			});
			ws.addEventListener('error', () => {
				try {
					ws.close();
				} catch {
					/* noop */
				}
			});
		}

		connect();

		return () => {
			disposed = true;
			if (reconnectTimer != null) clearTimeout(reconnectTimer);
			try {
				socket?.close();
			} catch {
				/* noop */
			}
		};
	}, [enabled]);
}
