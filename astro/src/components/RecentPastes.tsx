import { useState, useEffect, useMemo } from 'react';
import { Button } from './ui/button';
import { T } from '../lib/typography';
import { cn } from '../lib/utils';

interface Paste {
	id: string;
	title?: string | null;
	language?: string | null;
	createdAt: string;
	readCount: number;
	isEncrypted?: boolean;
}

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 15_000;

type SortField = 'title' | 'language' | 'reads' | 'created';
type SortDir = 'asc' | 'desc';

function formatDate(date: Date): string {
	return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function relativeAge(date: Date): string {
	const ms = Date.now() - date.getTime();
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 30) return `${d}d ago`;
	return formatDate(date);
}

export default function RecentPastes() {
	const [pastes, setPastes] = useState<Paste[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(0);
	const [sortField, setSortField] = useState<SortField>('created');
	const [sortDir, setSortDir] = useState<SortDir>('desc');

	useEffect(() => {
		let cancelled = false;
		let pollHandle: ReturnType<typeof setInterval> | null = null;

		async function load() {
			try {
				const response = await fetch(`/api/recent?limit=200&_=${Date.now()}`);
				if (cancelled) return;
				if (!response.ok) throw new Error('Failed to fetch recent pastes');
				const data = (await response.json()) as { pastes?: Paste[] };
				setPastes(data.pastes || []);
				setError(null);
			} catch {
				if (cancelled) return;
				setError('Failed to load recent pastes.');
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		function startPolling() {
			if (pollHandle != null) return;
			pollHandle = setInterval(load, POLL_INTERVAL_MS);
		}
		function stopPolling() {
			if (pollHandle == null) return;
			clearInterval(pollHandle);
			pollHandle = null;
		}
		function onVisibility() {
			if (document.visibilityState === 'visible') {
				void load();
				startPolling();
			} else {
				stopPolling();
			}
		}

		void load();
		if (document.visibilityState === 'visible') startPolling();
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			cancelled = true;
			stopPolling();
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, []);

	const sorted = useMemo(() => {
		const arr = [...pastes];
		arr.sort((a, b) => {
			let cmp = 0;
			switch (sortField) {
				case 'title':
					cmp = (a.title || '').localeCompare(b.title || '');
					break;
				case 'language':
					cmp = (a.language || '').localeCompare(b.language || '');
					break;
				case 'reads':
					cmp = a.readCount - b.readCount;
					break;
				case 'created':
					cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
					break;
			}
			return sortDir === 'asc' ? cmp : -cmp;
		});
		return arr;
	}, [pastes, sortField, sortDir]);

	const toggleSort = (field: SortField) => {
		if (sortField === field) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
		} else {
			setSortField(field);
			setSortDir(field === 'title' || field === 'language' ? 'asc' : 'desc');
		}
	};

	if (loading) {
		return <p className={T.mutedSm}>Loading…</p>;
	}

	if (error) {
		return (
			<div className="notice notice-destructive">
				<span className="text-xs font-bold uppercase tracking-wide shrink-0">ERROR</span>
				<span className="text-xs">{error}</span>
				<button onClick={() => window.location.reload()} className="ml-auto text-xs underline">Retry</button>
			</div>
		);
	}

	if (pastes.length === 0) {
		return (
			<div className="border border-border bg-card px-4 py-8 text-center">
				<p className="text-sm mb-3">No public pastes yet.</p>
				<Button variant="primary" asChild>
					<a href="/" className="no-underline">Create a paste →</a>
				</Button>
			</div>
		);
	}

	const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
	const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	return (
		<div className="animate-fade-in">
			<div className="overflow-x-auto">
				<table className="table-utility">
					<thead>
						<tr>
							<SortHeader field="title" current={sortField} dir={sortDir} onClick={toggleSort}>Title</SortHeader>
							<SortHeader field="language" current={sortField} dir={sortDir} onClick={toggleSort}>Lang</SortHeader>
							<SortHeader field="reads" current={sortField} dir={sortDir} onClick={toggleSort} className="text-right">Reads</SortHeader>
							<SortHeader field="created" current={sortField} dir={sortDir} onClick={toggleSort}>Age</SortHeader>
							<th className="col-actions">Action</th>
						</tr>
					</thead>
					<tbody>
						{paginated.map((paste) => (
							<tr key={paste.id}>
								<td className="font-medium max-w-xs">
									<a href={`/pastes/${paste.id}`} className="text-link hover:underline truncate block">
										{paste.isEncrypted ? '🔒 Encrypted paste' : paste.title || 'Untitled'}
									</a>
								</td>
								<td className="text-muted-foreground text-xs">{paste.isEncrypted ? '—' : paste.language || '—'}</td>
								<td className="text-right font-mono">{paste.readCount}</td>
								<td className="text-muted-foreground text-xs whitespace-nowrap">{relativeAge(new Date(paste.createdAt))}</td>
								<td className="col-actions">
									<a href={`/pastes/${paste.id}`} className="text-link no-underline hover:underline text-xs uppercase tracking-wide">
										View →
									</a>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-between gap-2 pt-3 text-xs">
					<span className="text-muted-foreground">
						Page <span className="font-mono">{page + 1}</span> of <span className="font-mono">{totalPages}</span> · <span className="font-mono">{sorted.length}</span> pastes
					</span>
					<div className="flex items-center gap-1">
						<Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
							← Prev
						</Button>
						<Button size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
							Next →
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Sortable header cell ────────────────────────────────────────────
function SortHeader({
	field,
	current,
	dir,
	onClick,
	children,
	className,
}: {
	field: SortField;
	current: SortField;
	dir: SortDir;
	onClick: (f: SortField) => void;
	children: React.ReactNode;
	className?: string;
}) {
	const isCurrent = current === field;
	return (
		<th
			className={cn('sortable', isCurrent && 'sorted', className)}
			onClick={() => onClick(field)}
			aria-sort={isCurrent ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
		>
			{children}
			<span className="sort-arrow font-mono" aria-hidden="true">
				{isCurrent ? (dir === 'asc' ? '↑' : '↓') : '·'}
			</span>
		</th>
	);
}
