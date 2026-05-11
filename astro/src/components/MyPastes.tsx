import { useState, useEffect } from 'react';
import { AlertCircle, Eye, Trash2, Lock, Globe, LogIn } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getSupabase, AUTH_ENABLED } from '../lib/supabase';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { T } from '../lib/typography';
import { cn } from '../lib/utils';

interface MyPaste {
	id: string;
	title: string | null;
	language: string | null;
	visibility: 'public' | 'private';
	read_count: number;
	created_at: string;
	expires_at: string;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function MyPastes() {
	const { user, loading: authLoading } = useAuth();
	const [pastes, setPastes] = useState<MyPaste[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (authLoading) return;
		if (!user) {
			setLoading(false);
			return;
		}

		const supabase = getSupabase();
		if (!supabase) {
			setError('Auth not configured');
			setLoading(false);
			return;
		}

		let cancelled = false;
		async function load() {
			// RLS: this query returns ONLY pastes where user_id = auth.uid().
			// No server-side filter needed -- the policies enforce it.
			const { data, error } = await supabase!
				.from('pastes')
				.select('id, title, language, visibility, read_count, created_at, expires_at')
				.eq('user_id', user!.id)
				.order('created_at', { ascending: false });

			if (cancelled) return;

			if (error) {
				setError(error.message);
			} else {
				setPastes((data ?? []) as MyPaste[]);
			}
			setLoading(false);
		}
		void load();

		return () => {
			cancelled = true;
		};
	}, [user, authLoading]);

	async function handleDelete(id: string) {
		if (!confirm('Delete this paste? This cannot be undone.')) return;
		const supabase = getSupabase();
		if (!supabase) return;

		// RLS: DELETE only succeeds when user_id = auth.uid().
		const { error } = await supabase.from('pastes').delete().eq('id', id);
		if (error) {
			alert(`Delete failed: ${error.message}`);
			return;
		}
		setPastes((prev) => prev.filter((p) => p.id !== id));
	}

	if (!AUTH_ENABLED) {
		return (
			<div className="py-12 text-center text-muted-foreground">
				Authentication is not configured for this deployment.
			</div>
		);
	}

	if (authLoading || loading) {
		return (
			<div className="space-y-3">
				{Array.from({ length: 3 }).map((_, i) => (
					<Card key={i}>
						<CardContent className="p-4">
							<div className="h-5 w-48 rounded-md bg-muted animate-pulse mb-2" />
							<div className="h-4 w-32 rounded-md bg-muted animate-pulse" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (!user) {
		return (
			<div className="py-12 text-center">
				<div className="mx-auto rounded-full w-14 h-14 bg-muted flex items-center justify-center mb-4">
					<LogIn className="h-6 w-6 text-muted-foreground" />
				</div>
				<h2 className={T.emptyTitle}>Sign in required</h2>
				<p className={cn(T.emptyDescription, 'mx-auto')}>Log in to see your saved pastes.</p>
				<Button asChild>
					<a href="/login">Log in</a>
				</Button>
			</div>
		);
	}

	if (error) {
		return (
			<div className="py-12 text-center">
				<div className="mx-auto rounded-full w-14 h-14 bg-destructive/10 flex items-center justify-center mb-4">
					<AlertCircle className="h-6 w-6 text-destructive" />
				</div>
				<h2 className={T.emptyTitle}>Error</h2>
				<p className={T.emptyDescription}>{error}</p>
			</div>
		);
	}

	if (pastes.length === 0) {
		return (
			<div className="py-12 text-center">
				<h2 className={T.emptyTitle}>No pastes yet</h2>
				<p className={cn(T.emptyDescription, 'mx-auto')}>
					Pastes you create while signed in will appear here.
				</p>
				<Button asChild>
					<a href="/">Create your first paste</a>
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				{pastes.length} paste{pastes.length === 1 ? '' : 's'}. Filtered by Postgres RLS — only your rows are returned.
			</p>
			{pastes.map((p) => (
				<Card key={p.id}>
					<CardContent className="p-4 flex flex-col md:flex-row justify-between gap-2">
						<div className="min-w-0">
							<h3 className={cn(T.pasteTitle, 'text-base truncate flex items-center gap-2')}>
								{p.visibility === 'public' ? (
									<Globe className="h-4 w-4 text-muted-foreground" />
								) : (
									<Lock className="h-4 w-4 text-muted-foreground" />
								)}
								{p.title || 'Untitled Paste'}
							</h3>
							<div className={cn(T.metaRow, 'mt-1 text-xs')}>
								<span>{formatDate(new Date(p.created_at))}</span>
								{p.language && <span className="badge bg-muted text-muted-foreground">{p.language}</span>}
								<span className="inline-flex items-center gap-1">
									<Eye className="h-3 w-3" /> {p.read_count}
								</span>
							</div>
						</div>
						<div className="flex items-start gap-2">
							<Button size="sm" variant="outline" asChild>
								<a href={`/pastes/${p.id}`}>View</a>
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => handleDelete(p.id)}
								aria-label="Delete paste"
								title="Delete"
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
