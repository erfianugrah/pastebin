import { describe, it, expect, vi } from 'vitest';
import { createFeedHub } from '../../../infrastructure/realtime/feedHub';
import type { PasteCreatedMeta, WsLike, RecentLiveMessage } from '../../../infrastructure/realtime/contract';

// Conformance suite for the browser-socket fan-out registry the Durable Object
// uses. Pure logic (no CF runtime), so it runs in plain vitest. The loop
// implements feedHub.ts to make this pass. Do not weaken.

const META: PasteCreatedMeta = {
	id: 'abc',
	title: 'T',
	language: null,
	createdAt: '2026-07-14T00:00:00Z',
	expiresAt: null,
	readCount: 0,
	isEncrypted: false,
	version: 0,
};

function fakeSocket(readyState = 1): WsLike & { send: ReturnType<typeof vi.fn> } {
	return {
		send: vi.fn(),
		close: vi.fn(),
		readyState,
		addEventListener: vi.fn(),
	};
}

describe('feedHub', () => {
	it('tracks size on add/remove', () => {
		const hub = createFeedHub();
		const a = fakeSocket();
		const b = fakeSocket();
		expect(hub.size()).toBe(0);
		hub.add(a);
		hub.add(b);
		expect(hub.size()).toBe(2);
		hub.remove(a);
		expect(hub.size()).toBe(1);
	});

	it('broadcasts a paste_created frame to every open socket', () => {
		const hub = createFeedHub();
		const a = fakeSocket();
		const b = fakeSocket();
		hub.add(a);
		hub.add(b);
		hub.broadcast(META);
		const expected: RecentLiveMessage = { type: 'paste_created', paste: META };
		for (const s of [a, b]) {
			expect(s.send).toHaveBeenCalledTimes(1);
			expect(JSON.parse(s.send.mock.calls[0][0])).toEqual(expected);
		}
	});

	it('skips and prunes non-open sockets', () => {
		const hub = createFeedHub();
		const open = fakeSocket(1);
		const closing = fakeSocket(2); // CLOSING
		hub.add(open);
		hub.add(closing);
		hub.broadcast(META);
		expect(open.send).toHaveBeenCalledTimes(1);
		expect(closing.send).not.toHaveBeenCalled();
		expect(hub.size()).toBe(1);
	});
});
