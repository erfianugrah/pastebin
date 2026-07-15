import { describe, it, expect, vi } from 'vitest';
import { createPhoenixClient } from '../../../infrastructure/realtime/phoenixClient';
import type { PasteCreatedMeta, WsLike } from '../../../infrastructure/realtime/contract';

// Conformance suite for the upstream Supabase Realtime client the Durable
// Object holds. Drives the exact JSON Phoenix protocol (v1.0.0) from
// supabase/guides/realtime/protocol.md against a fake transport + fake clock.
// The loop implements phoenixClient.ts to make this pass. Do not weaken.

const ANON = 'anon.jwt.token';
const SUPA = 'https://abcdefgh.supabase.co';

const META: PasteCreatedMeta = {
	id: '11111111-1111-1111-1111-111111111111',
	title: 'Hello',
	language: 'ts',
	createdAt: '2026-07-14T00:00:00Z',
	expiresAt: null,
	readCount: 0,
	isEncrypted: false,
	version: 0,
};

class FakeWs implements WsLike {
	sent: string[] = [];
	readyState = 1; // OPEN
	private listeners: Record<string, ((e: any) => void)[]> = {};
	send(d: string) {
		this.sent.push(d);
	}
	close() {
		this.readyState = 3;
		this.emit('close', { code: 1000 });
	}
	addEventListener(type: string, cb: (e: any) => void) {
		(this.listeners[type] ||= []).push(cb);
	}
	emit(type: string, e: any = {}) {
		for (const cb of this.listeners[type] || []) cb(e);
	}
	recv(frame: unknown) {
		this.emit('message', { data: JSON.stringify(frame) });
	}
	sentFrames() {
		return this.sent.map((s) => JSON.parse(s));
	}
}

function harness() {
	const sockets: FakeWs[] = [];
	const timers = new Map<number, { fn: () => void; at: number }>();
	let clock = 0;
	let nextId = 0;
	const deps = {
		connect: vi.fn((_url: string) => {
			const ws = new FakeWs();
			sockets.push(ws);
			return ws;
		}),
		setTimeout: (fn: () => void, ms: number) => {
			const id = ++nextId;
			timers.set(id, { fn, at: clock + ms });
			return id;
		},
		clearTimeout: (id: number) => {
			timers.delete(id);
		},
		now: () => clock,
	};
	const advance = (ms: number) => {
		clock += ms;
		for (const [id, t] of [...timers]) {
			if (t.at <= clock) {
				timers.delete(id);
				t.fn();
			}
		}
	};
	return { sockets, deps, advance };
}

function baseConfig(over: Partial<Parameters<typeof createPhoenixClient>[0]> = {}) {
	return {
		supabaseUrl: SUPA,
		anonKey: ANON,
		topic: 'recent:public',
		event: 'paste_created',
		onPaste: vi.fn(),
		...over,
	};
}

describe('phoenixClient', () => {
	it('connects to the realtime websocket URL with apikey + vsn', () => {
		const { deps } = harness();
		const client = createPhoenixClient(baseConfig(), deps);
		client.start();
		expect(deps.connect).toHaveBeenCalledTimes(1);
		const url = deps.connect.mock.calls[0][0];
		expect(url).toMatch(/^wss:\/\//);
		expect(url).toContain('/realtime/v1/websocket');
		expect(url).toContain(`apikey=${ANON}`);
		expect(url).toContain('vsn=1.0.0');
	});

	it('sends a private phx_join for realtime:<topic> on open', () => {
		const { sockets, deps } = harness();
		createPhoenixClient(baseConfig(), deps).start();
		sockets[0].emit('open');
		const join = sockets[0].sentFrames().find((f) => f.event === 'phx_join');
		expect(join).toBeTruthy();
		expect(join.topic).toBe('realtime:recent:public');
		expect(join.payload.config.private).toBe(true);
		expect(join.payload.access_token).toBe(ANON);
		expect(join.ref).toBeTruthy();
		expect(join.join_ref).toBeTruthy();
	});

	it('reports joined on a successful phx_reply', () => {
		const { sockets, deps } = harness();
		const onStatusChange = vi.fn();
		createPhoenixClient(baseConfig({ onStatusChange }), deps).start();
		sockets[0].emit('open');
		const join = sockets[0].sentFrames().find((f) => f.event === 'phx_join');
		sockets[0].recv({
			topic: 'realtime:recent:public',
			event: 'phx_reply',
			payload: { status: 'ok', response: {} },
			ref: join.ref,
		});
		expect(onStatusChange).toHaveBeenCalledWith('joined');
	});

	it('sends a heartbeat within 25s', () => {
		const { sockets, deps, advance } = harness();
		createPhoenixClient(baseConfig(), deps).start();
		sockets[0].emit('open');
		advance(25_000);
		const hb = sockets[0].sentFrames().find((f) => f.event === 'heartbeat');
		expect(hb).toBeTruthy();
		expect(hb.topic).toBe('phoenix');
	});

	it('surfaces a paste_created broadcast to onPaste', () => {
		const { sockets, deps } = harness();
		const cfg = baseConfig();
		createPhoenixClient(cfg, deps).start();
		sockets[0].emit('open');
		sockets[0].recv({
			topic: 'realtime:recent:public',
			event: 'broadcast',
			payload: { type: 'broadcast', event: 'paste_created', payload: META },
			ref: null,
		});
		expect(cfg.onPaste).toHaveBeenCalledTimes(1);
		expect(cfg.onPaste).toHaveBeenCalledWith(META);
	});

	it('ignores broadcasts for other events', () => {
		const { sockets, deps } = harness();
		const cfg = baseConfig();
		createPhoenixClient(cfg, deps).start();
		sockets[0].emit('open');
		sockets[0].recv({
			topic: 'realtime:recent:public',
			event: 'broadcast',
			payload: { type: 'broadcast', event: 'something_else', payload: META },
			ref: null,
		});
		expect(cfg.onPaste).not.toHaveBeenCalled();
	});

	it('reconnects after a phx_error with backoff', () => {
		const { sockets, deps, advance } = harness();
		createPhoenixClient(baseConfig(), deps).start();
		sockets[0].emit('open');
		sockets[0].recv({ topic: 'realtime:recent:public', event: 'phx_error', payload: {}, ref: '1' });
		expect(deps.connect).toHaveBeenCalledTimes(1); // not immediate
		advance(10_000); // within the backoff ladder
		expect(deps.connect.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it('requests broadcast replay on rejoin but not on the first join', () => {
		const { sockets, deps, advance } = harness();
		createPhoenixClient(baseConfig(), deps).start();
		sockets[0].emit('open');
		const first = sockets[0].sentFrames().find((f) => f.event === 'phx_join');
		expect(first.payload.config.broadcast.replay).toBeUndefined();
		// join ok sets the replay cursor
		sockets[0].recv({ topic: 'realtime:recent:public', event: 'phx_reply', payload: { status: 'ok' }, ref: first.ref });
		// force a reconnect
		sockets[0].recv({ topic: 'realtime:recent:public', event: 'phx_error', payload: {}, ref: '1' });
		advance(10_000);
		sockets[1].emit('open');
		const rejoin = sockets[1].sentFrames().find((f) => f.event === 'phx_join');
		expect(rejoin.payload.config.broadcast.replay).toBeDefined();
		expect(typeof rejoin.payload.config.broadcast.replay.since).toBe('number');
		expect(rejoin.payload.config.broadcast.replay.limit).toBeGreaterThan(0);
	});

	it('does not reconnect after stop()', () => {
		const { sockets, deps, advance } = harness();
		const client = createPhoenixClient(baseConfig(), deps);
		client.start();
		sockets[0].emit('open');
		client.stop();
		expect(sockets[0].readyState).toBe(3); // closed
		sockets[0].emit('close', { code: 1006 });
		advance(60_000);
		expect(deps.connect).toHaveBeenCalledTimes(1);
	});
});
