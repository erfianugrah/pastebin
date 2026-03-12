import { useState, useEffect } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { T } from '../lib/typography';

interface Paste {
	id: string;
	title?: string;
	language?: string;
	createdAt: string;
	readCount: number;
}

function formatDate(date: Date): string {
	return date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

function LoadingSkeleton() {
	return (
		<div className="grid gap-4">
			{Array.from({ length: 5 }).map((_, i) => (
				<Card key={i}>
					<CardContent className="p-4 flex flex-col md:flex-row justify-between gap-2">
						<div className="space-y-2 flex-1">
							<div className="h-5 w-48 rounded bg-muted animate-pulse" />
							<div className="flex gap-4">
								<div className="h-4 w-28 rounded bg-muted animate-pulse" />
								<div className="h-4 w-20 rounded bg-muted animate-pulse" />
								<div className="h-4 w-16 rounded bg-muted animate-pulse" />
							</div>
						</div>
						<div className="h-9 w-16 rounded bg-muted animate-pulse" />
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

	useEffect(() => {
		async function load() {
			try {
				const response = await fetch(`/api/recent?_=${Date.now()}`);
				if (!response.ok) throw new Error('Failed to fetch recent pastes');
				const data = await response.json();
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
				<div className="mx-auto rounded-full w-16 h-16 bg-destructive/10 flex items-center justify-center mb-4">
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-destructive">
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="8" x2="12" y2="12" />
						<line x1="12" y1="16" x2="12.01" y2="16" />
					</svg>
				</div>
				<h2 className="text-xl font-semibold mb-2">Error Loading Pastes</h2>
				<p className="text-muted-foreground max-w-md mx-auto mb-6">{error}</p>
				<Button variant="outline" onClick={() => window.location.reload()}>
					Try Again
				</Button>
			</div>
		);
	}

	if (pastes.length === 0) {
		return (
			<div className="py-12 text-center">
				<div className="mx-auto rounded-full w-16 h-16 bg-muted flex items-center justify-center mb-4">
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
						<path d="M12 7v10" />
						<path d="M7 12h10" />
					</svg>
				</div>
				<h2 className="text-xl font-semibold mb-2">No Public Pastes Found</h2>
				<p className="text-muted-foreground max-w-md mx-auto mb-6">
					There are no public pastes available to view. Create a new paste with public visibility to have it appear here.
				</p>
				<a href="/">
					<Button>Create New Paste</Button>
				</a>
			</div>
		);
	}

	return (
		<div className="grid gap-4">
			{pastes.map((paste, i) => (
				<Card
					key={paste.id}
					className="animate-fade-in-up opacity-0 overflow-hidden"
					style={{ animationDelay: `${i * 50}ms` }}
				>
					<CardContent className="p-4 flex flex-col md:flex-row justify-between gap-2">
						<div>
							<h3 className={T.pasteTitle}>{paste.title || 'Untitled Paste'}</h3>
							<div className={`${T.metaRow} mt-1`}>
								<span>Created: {formatDate(new Date(paste.createdAt))}</span>
								{paste.language && <span>Language: {paste.language}</span>}
								<span>Views: {paste.readCount}</span>
							</div>
						</div>
						<div className="flex items-start gap-2">
							<a href={`/pastes/${paste.id}`}>
								<Button size="sm">View</Button>
							</a>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
