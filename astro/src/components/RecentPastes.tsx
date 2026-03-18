import { useState, useEffect } from 'react';
import { AlertCircle, Plus, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
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

const PAGE_SIZE = 10;

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

export default function RecentPastes() {
	const [pastes, setPastes] = useState<Paste[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(0);

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

	if (loading) return <LoadingSkeleton />;

	if (error) {
		return (
			<div className="py-12 text-center">
				<div className="mx-auto rounded-full w-14 h-14 bg-destructive/10 flex items-center justify-center mb-4">
					<AlertCircle className="h-6 w-6 text-destructive" />
				</div>
				<h2 className={T.emptyTitle}>Error Loading Pastes</h2>
				<p className={T.emptyDescription}>{error}</p>
				<Button variant="outline" onClick={() => window.location.reload()}>Try Again</Button>
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
				<p className={cn(T.emptyDescription, 'mx-auto')}>
					Create a new paste with public visibility to have it appear here.
				</p>
				<Button asChild><a href="/">Create New Paste</a></Button>
			</div>
		);
	}

	// Pagination
	const totalPages = Math.ceil(pastes.length / PAGE_SIZE);
	const paginated = pastes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	return (
		<div className="space-y-3">
			{paginated.map((paste, i) => (
				<Card
					key={paste.id}
					className="animate-fade-in-up opacity-0 overflow-hidden"
					style={{ animationDelay: `${i * 40}ms` }}
				>
					<CardContent className="p-4 flex flex-col md:flex-row justify-between gap-2">
						<div className="min-w-0">
							<h3 className={cn(T.pasteTitle, 'text-base truncate')}>{paste.title || 'Untitled Paste'}</h3>
							<div className={cn(T.metaRow, 'mt-1 text-xs')}>
								<span>{formatDate(new Date(paste.createdAt))}</span>
								{paste.language && (
									<span className="badge bg-muted text-muted-foreground">{paste.language}</span>
								)}
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
					<Button
						variant="outline"
						size="sm"
						disabled={page === 0}
						onClick={() => setPage(page - 1)}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className={T.muted}>
						{page + 1} / {totalPages}
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={page >= totalPages - 1}
						onClick={() => setPage(page + 1)}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			)}
		</div>
	);
}
