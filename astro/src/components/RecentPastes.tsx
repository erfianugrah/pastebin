import { useState, useEffect } from 'react';
import { AlertCircle, Plus, ChevronLeft, ChevronRight, Eye, Radio } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { T } from '../lib/typography';
import { cn } from '../lib/utils';

interface Paste {
	id: string;
	title?: string;
	language?: string;
	createdAt: string;
	readCount: number;
}

/**
 * Realtime broadcast payload from the `broadcast_public_paste_insert`
 * Postgres trigger. Mirrors the /api/recent response shape so we can
 * prepend events directly to the list state.
 */
interface PasteCreatedBroadcast {
	id: string;
	title: string;
	language: string | null;
	createdAt: string;
	expiresAt: string;
	readCount: number;
	isEncrypted: boolean;
	version: number;
}

const PAGE_SIZE = 10;

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REALTIME_ENABLED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

function formatDate(date: Date): string {
	return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function LoadingSkeleton() {
	return (
		<div className="space-y-3">
			{Array.from({ length: 5 }).map((_, i) => (
				<Card key={i}>
					<CardContent className="p-4">
						<div className="flex flex-col md:flex-row justify-between gap-3">
							<div className="space-y-2 flex-1">
								<div className="h-5 w-48 rounded-md bg-muted animate-pulse" />
								<div className="flex gap-3">
									<div className="h-4 w-24 rounded-md bg-muted animate-pulse" />
									<div className="h-4 w-16 rounded-md bg-muted animate-pulse" />
									<div className="h-4 w-14 rounded-md bg-muted animate-pulse" />
								</div>
							</div>
							<div className="h-8 w-14 rounded-md bg-muted animate-pulse" />
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

type LiveStatus = 'off' | 'connecting' | 'subscribed' | 'error';

function LiveIndicator({ status }: { status: LiveStatus }) {
	if (status === 'off') return null;
	const color = status === 'subscribed' ? 'bg-green-500' : status === 'connecting' ? 'bg-yellow-500' : 'bg-red-500';
	const label = status === 'subscribed' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline';
	return (
		<div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
			<span className="relative inline-flex h-2 w-2">
				<span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', color)} />
				<span className={cn('relative inline-flex h-2 w-2 rounded-full', color)} />
			</span>
			<Radio className="h-3 w-3" /> {label}
		</div>
	);
}

export default function RecentPastes() {
	const [pastes, setPastes] = useState<Paste[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(0);
	const [liveStatus, setLiveStatus] = useState<LiveStatus>(REALTIME_ENABLED ? 'connecting' : 'off');

	// Initial fetch
	useEffect(() => {
		async function load() {
			try {
				const response = await fetch(`/api/recent?limit=100&_=${Date.now()}`);
				if (!response.ok) throw new Error('Failed to fetch recent pastes');
				const data = (await response.json()) as { pastes?: Paste[] };
				setPastes(data.pastes || []);
			} catch {
				setError('There was an error loading recent pastes. Please try again later.');
			} finally {
				setLoading(false);
			}
		}
		load();
	}, []);

	// Realtime subscription
	useEffect(() => {
		if (!REALTIME_ENABLED) return;

		const supabase = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
			auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
		});

		let cancelled = false;
		void supabase.realtime.setAuth(SUPABASE_PUBLISHABLE_KEY!);

		const channel = supabase
			.channel('recent:public', { config: { private: true } })
			.on('broadcast', { event: 'paste_created' }, (msg) => {
				// realtime.send wraps the payload one level: msg.payload.payload
				const raw = (msg.payload as { payload?: PasteCreatedBroadcast } | undefined)?.payload ?? (msg.payload as PasteCreatedBroadcast);

				if (!raw || !raw.id) return;

				setPastes((prev) => {
					// Dedupe: skip if we already have this paste (covers the race where
					// the initial fetch returned the row after Realtime delivered it).
					if (prev.some((p) => p.id === raw.id)) return prev;

					const next: Paste = {
						id: raw.id,
						title: raw.title,
						language: raw.language ?? undefined,
						createdAt: raw.createdAt,
						readCount: raw.readCount,
					};
					return [next, ...prev];
				});

				// Snap pagination to the first page so new pastes are visible
				setPage(0);
			})
			.subscribe((status) => {
				if (cancelled) return;
				if (status === 'SUBSCRIBED') setLiveStatus('subscribed');
				else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
					setLiveStatus('error');
				}
			});

		return () => {
			cancelled = true;
			void channel.unsubscribe();
			void supabase.removeAllChannels();
		};
	}, []);

	if (loading) return <LoadingSkeleton />;

	if (error) {
		return (
			<div className="py-12 text-center">
				<div className="mx-auto rounded-full w-14 h-14 bg-destructive/10 flex items-center justify-center mb-4">
					<AlertCircle className="h-6 w-6 text-destructive" />
				</div>
				<h2 className={T.emptyTitle}>Error Loading Pastes</h2>
				<p className={T.emptyDescription}>{error}</p>
				<Button variant="outline" onClick={() => window.location.reload()}>
					Try Again
				</Button>
			</div>
		);
	}

	if (pastes.length === 0) {
		return (
			<div className="py-12 text-center">
				<div className="mx-auto rounded-full w-14 h-14 bg-muted flex items-center justify-center mb-4">
					<Plus className="h-6 w-6 text-muted-foreground" />
				</div>
				<h2 className={T.emptyTitle}>No Public Pastes Found</h2>
				<p className={cn(T.emptyDescription, 'mx-auto')}>Create a new paste with public visibility to have it appear here.</p>
				<Button asChild>
					<a href="/">Create New Paste</a>
				</Button>
			</div>
		);
	}

	// Pagination
	const totalPages = Math.ceil(pastes.length / PAGE_SIZE);
	const paginated = pastes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	return (
		<div className="space-y-3">
			{REALTIME_ENABLED && (
				<div className="flex items-center justify-end">
					<LiveIndicator status={liveStatus} />
				</div>
			)}
			{paginated.map((paste, i) => (
				<Card key={paste.id} className="animate-fade-in-up opacity-0 overflow-hidden" style={{ animationDelay: `${i * 40}ms` }}>
					<CardContent className="p-4 flex flex-col md:flex-row justify-between gap-2">
						<div className="min-w-0">
							<h3 className={cn(T.pasteTitle, 'text-base truncate')}>{paste.title || 'Untitled Paste'}</h3>
							<div className={cn(T.metaRow, 'mt-1 text-xs')}>
								<span>{formatDate(new Date(paste.createdAt))}</span>
								{paste.language && <span className="badge bg-muted text-muted-foreground">{paste.language}</span>}
								<span className="inline-flex items-center gap-1">
									<Eye className="h-3 w-3" /> {paste.readCount}
								</span>
							</div>
						</div>
						<div className="flex items-start">
							<Button size="sm" asChild>
								<a href={`/pastes/${paste.id}`}>View</a>
							</Button>
						</div>
					</CardContent>
				</Card>
			))}

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-center gap-2 pt-2">
					<Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className={T.muted}>
						{page + 1} / {totalPages}
					</span>
					<Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			)}
		</div>
	);
}
