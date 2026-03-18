import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock crypto.randomUUID
if (!globalThis.crypto?.randomUUID) {
	Object.defineProperty(globalThis, 'crypto', {
		value: {
			...globalThis.crypto,
			randomUUID: () => '00000000-0000-0000-0000-000000000000',
			getRandomValues: (arr: Uint8Array) => {
				for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
				return arr;
			},
		},
	});
}

// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(window, 'localStorage', {
	value: {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, val: string) => { store[key] = val; },
		removeItem: (key: string) => { delete store[key]; },
		clear: () => { Object.keys(store).forEach(k => delete store[k]); },
	},
});

// Mock sessionStorage
const sessionStore: Record<string, string> = {};
Object.defineProperty(window, 'sessionStorage', {
	value: {
		getItem: (key: string) => sessionStore[key] ?? null,
		setItem: (key: string, val: string) => { sessionStore[key] = val; },
		removeItem: (key: string) => { delete sessionStore[key]; },
		clear: () => { Object.keys(sessionStore).forEach(k => delete sessionStore[k]); },
	},
});
