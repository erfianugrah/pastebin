import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { T } from '../lib/typography';

type DeleteState = 'confirm' | 'loading' | 'success' | 'error';

export default function DeletePaste() {
	const [state, setState] = useState<DeleteState>('confirm');
	const [errorMessage, setErrorMessage] = useState('');

	const pathParts = typeof window !== 'undefined' ? window.location.pathname.split('/') : [];
	const pasteId = pathParts[pathParts.length - 2] || '';
	const isValidId = /^[a-zA-Z0-9_-]+$/.test(pasteId);

	async function handleDelete() {
		setState('loading');
		try {
			const response = await fetch(`/pastes/${pasteId}/delete`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
			});
			const result = (await response.json()) as { error?: { message?: string } };

			if (response.ok) {
				setState('success');
			} else {
				setErrorMessage(result.error?.message || 'Could not delete this paste.');
				setState('error');
			}
		} catch {
			setErrorMessage('Network error. Please try again.');
			setState('error');
		}
	}

	if (!isValidId) {
		return (
			<ErrorCard message="Invalid paste ID." />
		);
	}

	// ── Confirm ──────────────────────────────────────────────────────
	if (state === 'confirm') {
		return (
			<div className="max-w-md mx-auto text-center py-8">
				<div className="rounded-full bg-destructive/10 p-3 inline-flex mb-4">
					<AlertTriangle className="h-6 w-6 text-destructive" />
				</div>
			<h2 className={T.emptyTitle}>Delete Paste</h2>
			<p className={T.mutedSm}>Are you sure you want to delete this paste?</p>
			<p className="text-xs font-mono text-muted-foreground mt-1 mb-4">{pasteId}</p>
				<p className="text-sm text-destructive mb-6">This action cannot be undone.</p>
				<div className="flex justify-center gap-3">
					<Button variant="destructive" onClick={handleDelete}>Delete Permanently</Button>
					<Button variant="outline" onClick={() => window.history.back()}>Cancel</Button>
				</div>
			</div>
		);
	}

	// ── Loading ──────────────────────────────────────────────────────
	if (state === 'loading') {
		return (
			<div className="flex flex-col items-center justify-center py-16">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-3" />
				<p className={T.mutedSm}>Deleting paste...</p>
			</div>
		);
	}

	// ── Success ──────────────────────────────────────────────────────
	if (state === 'success') {
		return (
			<div className="max-w-md mx-auto text-center py-8">
				<div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3 inline-flex mb-4">
					<CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
				</div>
			<h2 className={T.emptyTitle}>Paste Deleted</h2>
			<p className={T.emptyDescription}>The paste has been permanently removed.</p>
				<Button asChild>
					<a href="/">Create a new paste</a>
				</Button>
			</div>
		);
	}

	// ── Error ────────────────────────────────────────────────────────
	return <ErrorCard message={errorMessage} />;
}

function ErrorCard({ message }: { message: string }) {
	return (
		<div className="max-w-md mx-auto text-center py-8">
			<div className="rounded-full bg-destructive/10 p-3 inline-flex mb-4">
				<AlertCircle className="h-6 w-6 text-destructive" />
			</div>
		<h2 className={T.emptyTitle}>Error</h2>
		<p className={T.emptyDescription}>{message}</p>
			<div className="flex justify-center gap-3">
				<Button asChild><a href="/">Home</a></Button>
				<Button variant="outline" onClick={() => window.history.back()}>Go Back</Button>
			</div>
		</div>
	);
}
