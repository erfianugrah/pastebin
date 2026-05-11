import { useEffect, useState, useCallback } from 'react';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';

interface AuthState {
	user: User | null;
	session: Session | null;
	loading: boolean;
}

export interface UseAuthResult extends AuthState {
	signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
	signUp: (email: string, password: string) => Promise<{ error: AuthError | null; needsConfirm: boolean }>;
	signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
	const [state, setState] = useState<AuthState>({ user: null, session: null, loading: true });

	useEffect(() => {
		const supabase = getSupabase();
		if (!supabase) {
			setState({ user: null, session: null, loading: false });
			return;
		}

		let cancelled = false;

		void supabase.auth.getSession().then(({ data }) => {
			if (cancelled) return;
			setState({ user: data.session?.user ?? null, session: data.session, loading: false });
		});

		const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
			if (cancelled) return;
			setState({ user: session?.user ?? null, session, loading: false });
		});

		return () => {
			cancelled = true;
			subscription.subscription.unsubscribe();
		};
	}, []);

	const signIn = useCallback(async (email: string, password: string) => {
		const supabase = getSupabase();
		if (!supabase) return { error: { message: 'Auth not configured' } as AuthError };
		const { error } = await supabase.auth.signInWithPassword({ email, password });
		return { error };
	}, []);

	const signUp = useCallback(async (email: string, password: string) => {
		const supabase = getSupabase();
		if (!supabase) return { error: { message: 'Auth not configured' } as AuthError, needsConfirm: false };
		const { data, error } = await supabase.auth.signUp({ email, password });
		// If the project requires email confirmation, signUp returns a user
		// but no session. session === null => user must check their email.
		const needsConfirm = !error && !data.session;
		return { error, needsConfirm };
	}, []);

	const signOut = useCallback(async () => {
		const supabase = getSupabase();
		if (!supabase) return;
		await supabase.auth.signOut();
	}, []);

	return { ...state, signIn, signUp, signOut };
}
