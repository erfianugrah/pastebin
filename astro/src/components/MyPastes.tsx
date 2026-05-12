import { useState, useEffect } from 'react';
import { AlertCircle, Eye, Trash2, Lock, Globe, LogIn, Plus } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
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

const FETCH_OPTS: RequestInit = { credentials: 'same-origin' };

const PAGE_SIZE = 50;

export default function MyPastes() {
	const { user, loading: authLoading } = useAuth();
	const [pastes, setPastes] = useState<MyPaste[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (authLoading) return;
		if (!user) {
			setLoading(false);
			return;
		}

		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`/api/my?limit=${PAGE_SIZE}`, FETCH_OPTS);
				if (cancelled) return;
				if (!res.ok) {
					const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
					setError(body.error?.message ?? `HTTP ${res.status}`);
					setLoading(false);
					return;
				}
				const data = (await res.json()) as { pastes: MyPaste[]; nextCursor: string | null };
				setPastes(data.pastes ?? []);
				setNextCursor(data.nextCursor ?? null);
				setLoading(false);
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : 'Failed to load');
				setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [user, authLoading]);

	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const res = await fetch(`/api/my?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`, FETCH_OPTS);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
				setError(body.error?.message ?? `HTTP ${res.status}`);
				return;
			}
			const data = (await res.json()) as { pastes: MyPaste[]; nextCursor: string | null };
			setPastes((prev) => [...prev, ...(data.pastes ?? [])]);
			setNextCursor(data.nextCursor ?? null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load');
		} finally {
			setLoadingMore(false);
		}
	}

	async function handleDelete(id: string) {
		if (!confirm('Delete this paste? This cannot be undone.')) return;

		// Use the existing /pastes/:id/delete endpoint. Worker reads the
		// session cookie and authorizes the delete via user_id match.
		const res = await fetch(`/pastes/${id}/delete`, {
			method: 'DELETE',
			...FETCH_OPTS,
		});

		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
			alert(`Delete failed: ${body.error?.message ?? `HTTP ${res.status}`}`);
			return;
		}
		setPastes((prev) => prev.filter((p) => p.id !== id));
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
			<div className="flex items-center justify-between gap-3">
				<p className="text-sm text-muted-foreground">
					{pastes.length} paste{pastes.length === 1 ? '' : 's'}
				</p>
				<Button asChild size="sm" variant="outline">
					<a href="/">
						<Plus className="h-4 w-4" />
						New paste
					</a>
				</Button>
			</div>
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
			{nextCursor && (
				<div className="pt-2 flex justify-center">
					<Button size="sm" variant="outline" onClick={loadMore} disabled={loadingMore}>
						{loadingMore ? 'Loading…' : 'Load more'}
					</Button>
				</div>
			)}
		</div>
	);
}
