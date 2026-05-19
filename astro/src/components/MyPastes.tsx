import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';
import { T } from '../lib/typography';
import { cn } from '../lib/utils';
import { showConfirmModal } from './ui/modal';
import { toast } from './ui/toast';

interface MyPaste {
	id: string;
	title: string | null;
	language: string | null;
	visibility: 'public' | 'private';
	read_count: number;
	created_at: string;
	expires_at: string;
}

const FETCH_OPTS: RequestInit = { credentials: 'same-origin' };
const PAGE_SIZE = 50;

type SortField = 'title' | 'visibility' | 'language' | 'reads' | 'created' | 'expires';
type SortDir = 'asc' | 'desc';

function relativeAge(date: Date, future = false): string {
	const ms = future ? date.getTime() - Date.now() : Date.now() - date.getTime();
	if (ms < 0) return future ? 'expired' : 'just now';
	const s = Math.floor(ms / 1000);
	if (s < 60) return future ? `in ${s}s` : `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return future ? `in ${m}m` : `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return future ? `in ${h}h` : `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 30) return future ? `in ${d}d` : `${d}d ago`;
	return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function MyPastes() {
	const { user, loading: authLoading } = useAuth();
	const [pastes, setPastes] = useState<MyPaste[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sortField, setSortField] = useState<SortField>('created');
	const [sortDir, setSortDir] = useState<SortDir>('desc');

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
		const confirmed = await showConfirmModal({
			title: 'Delete paste',
			description: 'This action cannot be undone.',
			confirmText: 'Delete',
			cancelText: 'Cancel',
			isDangerous: true,
		});
		if (!confirmed) return;

		const res = await fetch(`/pastes/${id}/delete`, {
			method: 'DELETE',
			...FETCH_OPTS,
		});

		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
			toast({ message: `Delete failed: ${body.error?.message ?? `HTTP ${res.status}`}`, type: 'error' });
			return;
		}
		setPastes((prev) => prev.filter((p) => p.id !== id));
		toast({ message: 'Deleted.', type: 'success' });
	}

	const sorted = useMemo(() => {
		const arr = [...pastes];
		arr.sort((a, b) => {
			let cmp = 0;
			switch (sortField) {
				case 'title':
					cmp = (a.title || '').localeCompare(b.title || '');
					break;
				case 'visibility':
					cmp = a.visibility.localeCompare(b.visibility);
					break;
				case 'language':
					cmp = (a.language || '').localeCompare(b.language || '');
					break;
				case 'reads':
					cmp = a.read_count - b.read_count;
					break;
				case 'created':
					cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
					break;
				case 'expires':
					cmp = new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime();
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
			setSortDir(field === 'title' || field === 'visibility' || field === 'language' ? 'asc' : 'desc');
		}
	};

	if (authLoading || loading) {
		return <p className={T.mutedSm}>Loading…</p>;
	}

	if (!user) {
		return (
			<div className="border border-border bg-card px-4 py-8 text-center">
				<p className="text-sm mb-3">Sign in to see your saved pastes.</p>
				<Button variant="primary" asChild>
					<a href="/login" className="no-underline">Log in →</a>
				</Button>
			</div>
		);
	}

	if (error) {
		return (
			<div className="notice notice-destructive">
				<span className="text-xs font-bold uppercase tracking-wide shrink-0">ERROR</span>
				<span className="text-xs">{error}</span>
			</div>
		);
	}

	if (pastes.length === 0) {
		return (
			<div className="border border-border bg-card px-4 py-8 text-center">
				<p className="text-sm mb-3">No pastes yet. Pastes you create while signed in appear here.</p>
				<Button variant="primary" asChild>
					<a href="/" className="no-underline">Create your first paste →</a>
				</Button>
			</div>
		);
	}

	return (
		<div className="animate-fade-in space-y-3">
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs text-muted-foreground uppercase tracking-wide">
					<span className="font-mono">{pastes.length}</span> paste{pastes.length === 1 ? '' : 's'}
				</p>
				<Button variant="primary" asChild>
					<a href="/" className="no-underline">+ New paste</a>
				</Button>
			</div>

			<div className="overflow-x-auto">
				<table className="table-utility">
					<thead>
						<tr>
							<SortHeader field="title" current={sortField} dir={sortDir} onClick={toggleSort}>Title</SortHeader>
							<SortHeader field="visibility" current={sortField} dir={sortDir} onClick={toggleSort}>Vis</SortHeader>
							<SortHeader field="language" current={sortField} dir={sortDir} onClick={toggleSort}>Lang</SortHeader>
							<SortHeader field="reads" current={sortField} dir={sortDir} onClick={toggleSort} className="text-right">Reads</SortHeader>
							<SortHeader field="created" current={sortField} dir={sortDir} onClick={toggleSort}>Age</SortHeader>
							<SortHeader field="expires" current={sortField} dir={sortDir} onClick={toggleSort}>Expires</SortHeader>
							<th className="col-actions">Actions</th>
						</tr>
					</thead>
					<tbody>
						{sorted.map((p) => (
							<tr key={p.id}>
								<td className="font-medium max-w-xs">
									<a href={`/pastes/${p.id}`} className="text-link hover:underline truncate block">
										{p.title || 'Untitled'}
									</a>
								</td>
								<td className="text-xs">
									<span className={cn('badge', p.visibility === 'private' && 'badge-warning')}>
										{p.visibility === 'private' ? 'priv' : 'pub'}
									</span>
								</td>
								<td className="text-muted-foreground text-xs">{p.language || '—'}</td>
								<td className="text-right font-mono">{p.read_count}</td>
								<td className="text-muted-foreground text-xs whitespace-nowrap">{relativeAge(new Date(p.created_at))}</td>
								<td className="text-muted-foreground text-xs whitespace-nowrap">{relativeAge(new Date(p.expires_at), true)}</td>
								<td className="col-actions text-xs uppercase tracking-wide whitespace-nowrap">
									<a href={`/pastes/${p.id}`} className="text-link no-underline hover:underline mr-2">View</a>
									<button onClick={() => handleDelete(p.id)} className="text-destructive hover:underline" aria-label="Delete">
										Del
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{nextCursor && (
				<div className="flex justify-center">
					<Button onClick={loadMore} disabled={loadingMore}>
						{loadingMore ? 'Loading…' : 'Load more'}
					</Button>
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
