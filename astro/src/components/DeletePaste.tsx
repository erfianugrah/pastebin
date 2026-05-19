import { useState } from 'react';
import { Button } from './ui/button';
import { loadPasteToken, removePasteToken } from '../lib/pasteTokenStorage';

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
			let token: string | null = null;
			try {
				token = sessionStorage.getItem('pasteriser_delete_token');
				if (token) sessionStorage.removeItem('pasteriser_delete_token');
			} catch { /* ignore */ }
			if (!token) {
				token = await loadPasteToken(pasteId);
			}

			const response = await fetch(`/pastes/${pasteId}/delete`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token }),
			});
			const result = (await response.json()) as { error?: { message?: string } };

			if (response.ok) {
				removePasteToken(pasteId);
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
		return <ErrorPanel message="Invalid paste ID." />;
	}

	// ── Confirm ──────────────────────────────────────────────────────
	if (state === 'confirm') {
		return (
			<div className="max-w-lg mx-auto border border-destructive bg-card animate-fade-in">
				<div className="border-b border-destructive px-4 py-2 bg-card-alt">
					<h1 className="text-sm font-bold uppercase tracking-wide text-destructive">⚠ Delete paste</h1>
				</div>
				<div className="px-4 py-3 space-y-3">
					<dl className="dl-inline">
						<dt>ID</dt>
						<dd className="font-mono">{pasteId}</dd>
					</dl>
					<p className="text-sm">
						Are you sure you want to delete this paste? <strong>This action cannot be undone.</strong>
					</p>
					<div className="flex gap-2">
						<Button variant="destructive" onClick={handleDelete}>
							Delete permanently
						</Button>
						<Button onClick={() => window.history.back()}>
							Cancel
						</Button>
					</div>
				</div>
			</div>
		);
	}

	// ── Loading ──────────────────────────────────────────────────────
	if (state === 'loading') {
		return (
			<div className="max-w-lg mx-auto border border-border bg-card px-4 py-6 text-center animate-fade-in">
				<p className="text-xs text-muted-foreground uppercase tracking-wide">Deleting…</p>
			</div>
		);
	}

	// ── Success ──────────────────────────────────────────────────────
	if (state === 'success') {
		return (
			<div className="max-w-lg mx-auto border border-success bg-card animate-fade-in">
				<div className="border-b border-success px-4 py-2 bg-card-alt">
					<h2 className="text-sm font-bold uppercase tracking-wide text-success">✓ Paste deleted</h2>
				</div>
				<div className="px-4 py-3 space-y-3">
					<p className="text-sm">The paste has been permanently removed.</p>
					<Button variant="primary" asChild>
						<a href="/" className="no-underline">New paste →</a>
					</Button>
				</div>
			</div>
		);
	}

	return <ErrorPanel message={errorMessage} />;
}

function ErrorPanel({ message }: { message: string }) {
	return (
		<div className="max-w-lg mx-auto border border-destructive bg-card animate-fade-in">
			<div className="border-b border-destructive px-4 py-2 bg-card-alt">
				<h2 className="text-sm font-bold uppercase tracking-wide text-destructive">× Error</h2>
			</div>
			<div className="px-4 py-3 space-y-3">
				<p className="text-sm">{message}</p>
				<div className="flex gap-2">
					<Button variant="primary" asChild>
						<a href="/" className="no-underline">Home</a>
					</Button>
					<Button onClick={() => window.history.back()}>← Go back</Button>
				</div>
			</div>
		</div>
	);
}
