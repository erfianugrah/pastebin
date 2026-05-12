import { useEffect, useState, useCallback } from 'react';

/**
 * Browser-side auth hook. Does NOT talk to Supabase directly — every
 * call goes to the Worker (same-origin) which proxies to Supabase
 * and stores the session in HttpOnly cookies. The browser never sees
 * the Supabase URL, key, or any session JWT in JS-readable storage.
 *
 * Design choice: this is the BFF (Backend-For-Frontend) pattern.
 *  - Browser → Worker → Supabase
 *  - CSP stays at `connect-src 'self'`
 *  - Tokens in HttpOnly cookies (XSS-safe)
 *  - One rate-limit surface (the Worker), not two
 */

interface User {
	id: string;
	email?: string;
	[key: string]: unknown;
}

interface AuthState {
	user: User | null;
	loading: boolean;
}

export interface UseAuthResult extends AuthState {
	signIn: (email: string, password: string) => Promise<{ error: { code?: string; message: string } | null }>;
	signUp: (email: string, password: string) => Promise<{ error: { code?: string; message: string } | null; needsConfirm: boolean }>;
	resendConfirmation: (email: string) => Promise<{ error: { message: string } | null }>;
	forgotPassword: (email: string) => Promise<{ error: { message: string } | null }>;
	updatePassword: (password: string) => Promise<{ error: { message: string } | null }>;
	signInWithMagicLink: (email: string) => Promise<{ error: { message: string } | null }>;
	signOut: () => Promise<void>;
	refresh: () => Promise<void>;
}

const FETCH_OPTS: RequestInit = { credentials: 'same-origin' };

async function readJsonOrNull<T>(res: Response): Promise<T | null> {
	try {
		return (await res.json()) as T;
	} catch {
		return null;
	}
}

export function useAuth(): UseAuthResult {
	const [state, setState] = useState<AuthState>({ user: null, loading: true });

	const refresh = useCallback(async () => {
		try {
			const res = await fetch('/api/auth/session', FETCH_OPTS);
			const data = await readJsonOrNull<{ user: User | null }>(res);
			setState({ user: data?.user ?? null, loading: false });
		} catch {
			setState({ user: null, loading: false });
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const signIn = useCallback(async (email: string, password: string) => {
		const res = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
			...FETCH_OPTS,
		});

		if (!res.ok) {
			const data = await readJsonOrNull<{ error?: { code?: string; message?: string } }>(res);
			return {
				error: {
					code: data?.error?.code,
					message: data?.error?.message ?? `HTTP ${res.status}`,
				},
			};
		}

		const data = await readJsonOrNull<{ user: User }>(res);
		setState({ user: data?.user ?? null, loading: false });
		return { error: null };
	}, []);

	const signUp = useCallback(async (email: string, password: string) => {
		const res = await fetch('/api/auth/signup', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
			...FETCH_OPTS,
		});

		if (!res.ok) {
			const data = await readJsonOrNull<{ error?: { code?: string; message?: string } }>(res);
			return {
				error: {
					code: data?.error?.code,
					message: data?.error?.message ?? `HTTP ${res.status}`,
				},
				needsConfirm: false,
			};
		}

		const data = await readJsonOrNull<{ user: User; needsConfirm: boolean }>(res);
		if (data && !data.needsConfirm) {
			setState({ user: data.user, loading: false });
		}
		return { error: null, needsConfirm: data?.needsConfirm ?? false };
	}, []);

	const resendConfirmation = useCallback(async (email: string) => {
		const res = await fetch('/api/auth/resend-confirmation', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email }),
			...FETCH_OPTS,
		});
		if (!res.ok) {
			const data = await readJsonOrNull<{ error?: { message?: string } }>(res);
			return { error: { message: data?.error?.message ?? `HTTP ${res.status}` } };
		}
		return { error: null };
	}, []);

	const forgotPassword = useCallback(async (email: string) => {
		const res = await fetch('/api/auth/forgot-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email }),
			...FETCH_OPTS,
		});
		if (!res.ok) {
			const data = await readJsonOrNull<{ error?: { message?: string } }>(res);
			return { error: { message: data?.error?.message ?? `HTTP ${res.status}` } };
		}
		return { error: null };
	}, []);

	const updatePassword = useCallback(async (password: string) => {
		const res = await fetch('/api/auth/update-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password }),
			...FETCH_OPTS,
		});
		if (!res.ok) {
			const data = await readJsonOrNull<{ error?: { message?: string } }>(res);
			return { error: { message: data?.error?.message ?? `HTTP ${res.status}` } };
		}
		return { error: null };
	}, []);

	const signInWithMagicLink = useCallback(async (email: string) => {
		const res = await fetch('/api/auth/magic-link', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email }),
			...FETCH_OPTS,
		});
		if (!res.ok) {
			const data = await readJsonOrNull<{ error?: { message?: string } }>(res);
			return { error: { message: data?.error?.message ?? `HTTP ${res.status}` } };
		}
		return { error: null };
	}, []);

	const signOut = useCallback(async () => {
		try {
			await fetch('/api/auth/logout', { method: 'POST', ...FETCH_OPTS });
		} finally {
			setState({ user: null, loading: false });
		}
	}, []);

	return { ...state, signIn, signUp, signOut, refresh, resendConfirmation, forgotPassword, updatePassword, signInWithMagicLink };
}
