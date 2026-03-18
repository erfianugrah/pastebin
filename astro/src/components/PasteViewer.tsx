import { useState, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { T } from '../lib/typography';
import CodeViewer from './CodeViewer';
import PasteActions from './PasteActions';

interface PasteData {
	id: string;
	content: string;
	title?: string;
	language?: string;
	createdAt: string;
	expiresAt: string;
	visibility: 'public' | 'private';
	isPasswordProtected: boolean;
	burnAfterReading: boolean;
	isEncrypted?: boolean;
	version?: string;
	securityType?: string;
	hasViewLimit?: boolean;
	viewLimit?: number;
	remainingViews?: number;
}

type ViewState = 'loading' | 'error' | 'ready';

export default function PasteViewer() {
	const [state, setState] = useState<ViewState>('loading');
	const [paste, setPaste] = useState<PasteData | null>(null);
	const [decryptedContent, setDecryptedContent] = useState<string | null>(null);

	const pasteId = typeof window !== 'undefined' ? window.location.pathname.split('/').pop() || '' : '';

	useEffect(() => {
		if (!pasteId) {
			setState('error');
			return;
		}

		async function fetchPaste() {
			try {
				const response = await fetch(`/pastes/${pasteId}`, {
					headers: { Accept: 'application/json' },
				});

				if (!response.ok) {
					setState('error');
					return;
				}

				const data = (await response.json()) as PasteData;
				setPaste(data);
				setState('ready');

				if (data.title) {
					document.title = `${data.title} - Pasteriser`;
				}
			} catch {
				setState('error');
			}
		}

		fetchPaste();
	}, [pasteId]);

	// ── Loading ──────────────────────────────────────────────────────
	if (state === 'loading') {
		return (
			<div className="flex flex-col items-center justify-center py-16 animate-fade-in">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-3" />
				<p className={T.mutedSm}>Loading paste...</p>
			</div>
		);
	}

	// ── Error ────────────────────────────────────────────────────────
	if (state === 'error' || !paste) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
				<div className="rounded-full bg-destructive/10 p-3 mb-4">
					<AlertCircle className="h-6 w-6 text-destructive" />
				</div>
				<h2 className={T.emptyTitle}>Paste Not Found</h2>
				<p className={T.emptyDescription}>
					This paste may have expired, been deleted, or never existed.
				</p>
				<Button asChild>
					<a href="/">Create a new paste</a>
				</Button>
			</div>
		);
	}

	// ── Ready ────────────────────────────────────────────────────────
	return (
		<div className="max-w-[900px] mx-auto animate-fade-in">
			<CodeViewer
				paste={paste}
				onDecrypted={setDecryptedContent}
			/>
			<PasteActions
				pasteId={paste.id}
				isEncrypted={!!paste.isEncrypted}
				getDecryptedContent={() => decryptedContent}
				getRawContent={() => paste.content}
			/>
		</div>
	);
}
