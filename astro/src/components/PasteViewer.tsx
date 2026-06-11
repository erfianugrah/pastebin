import { useState, useEffect } from 'react';
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
	const [decryptedTitle, setDecryptedTitle] = useState<string | undefined>(undefined);

	// Support both /pastes/:id and /p/:slug URLs
	const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
	const isVanity = pathname.startsWith('/p/');
	const idOrSlug = isVanity
		? pathname.split('/')[2] || ''
		: pathname.split('/').pop() || '';

	useEffect(() => {
		if (!idOrSlug) {
			setState('error');
			return;
		}

		async function fetchPaste() {
			try {
				const fetchUrl = isVanity ? `/p/${idOrSlug}` : `/pastes/${idOrSlug}`;
				const response = await fetch(fetchUrl, {
					headers: { Accept: 'application/json' },
				});

				if (!response.ok) {
					setState('error');
					return;
				}

				const data = (await response.json()) as PasteData;
				setPaste(data);
				setState('ready');

				// For version-3 pastes data.title is ciphertext — don't leak it into
				// the document title. Show a neutral placeholder until CodeViewer
				// decrypts it (see onTitleDecrypted below).
				if (Number(data.version) >= 3 && data.title) {
					document.title = 'Encrypted paste - Pasteriser';
				} else if (data.title) {
					document.title = `${data.title} - Pasteriser`;
				}
			} catch {
				setState('error');
			}
		}

		fetchPaste();
	}, [idOrSlug]);

	// ── Loading ──────────────────────────────────────────────────────
	if (state === 'loading') {
		return (
			<div className="py-12 text-center animate-fade-in">
				<p className={T.mutedSm}>Loading paste…</p>
			</div>
		);
	}

	// ── Error ────────────────────────────────────────────────────────
	if (state === 'error' || !paste) {
		return (
			<div className="border border-destructive bg-card animate-fade-in">
				<div className="border-b border-destructive px-4 py-2 bg-card-alt">
					<span className="text-xs font-bold uppercase tracking-wide text-destructive">
						× Paste not found
					</span>
				</div>
				<div className="px-4 py-3 space-y-3">
					<p className="text-sm">
						This paste may have expired, been deleted, or never existed.
					</p>
					<Button variant="primary" asChild>
						<a href="/" className="no-underline">New paste →</a>
					</Button>
				</div>
			</div>
		);
	}

	// ── Ready ────────────────────────────────────────────────────────
	return (
		<div className="animate-fade-in">
			<CodeViewer
				paste={paste}
				onDecrypted={setDecryptedContent}
				onTitleDecrypted={(t) => {
					setDecryptedTitle(t);
					if (t) document.title = `${t} - Pasteriser`;
				}}
			/>
			<PasteActions
				pasteId={paste.id}
				pasteTitle={decryptedTitle ?? (Number(paste.version) >= 3 ? undefined : paste.title)}
				pasteLanguage={paste.language}
				isEncrypted={!!paste.isEncrypted}
				getDecryptedContent={() => decryptedContent}
				getRawContent={() => paste.content}
			/>
		</div>
	);
}
