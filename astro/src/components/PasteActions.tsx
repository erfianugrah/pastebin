import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { toast } from './ui/toast';
import { showConfirmModal } from './ui/modal';
import { cn } from '../lib/utils';
import { hasPasteToken, loadPasteToken } from '../lib/pasteTokenStorage';

// [B2] QR rendering is local-only. Previous version sent `window.location.href`
// — including any `#key=…` E2EE fragment — as a query string to a third-party
// QR generator. Rendering in the browser keeps the fragment local.

interface PasteActionsProps {
	pasteId: string;
	pasteTitle?: string;
	pasteLanguage?: string;
	isEncrypted: boolean;
	getDecryptedContent: () => string | null;
	getRawContent: () => string;
}

/** Map language IDs to file extensions */
const LANG_EXT: Record<string, string> = {
	javascript: 'js', typescript: 'ts', python: 'py', ruby: 'rb', go: 'go',
	rust: 'rs', java: 'java', csharp: 'cs', cpp: 'cpp', c: 'c',
	bash: 'sh', powershell: 'ps1', php: 'php', swift: 'swift', kotlin: 'kt',
	scala: 'scala', perl: 'pl', r: 'r', sql: 'sql', graphql: 'graphql',
	json: 'json', yaml: 'yml', toml: 'toml', ini: 'ini', markdown: 'md',
	markup: 'html', css: 'css', scss: 'scss', less: 'less', latex: 'tex',
	docker: 'Dockerfile', hcl: 'tf', nginx: 'conf', jsx: 'jsx', tsx: 'tsx',
};

// ── Keyboard shortcut helper ────────────────────────────────────────
// Activates a single-letter shortcut when:
//   - the user is NOT typing in an input/textarea/contenteditable
//   - no modifier keys (ctrl/meta/alt) are held — leaves Ctrl+R reload etc alone
//   - shift is allowed for capital matches (some users hold it for muscle memory)
function shouldHandleShortcut(e: KeyboardEvent): boolean {
	if (e.ctrlKey || e.metaKey || e.altKey) return false;
	const t = e.target as HTMLElement | null;
	if (!t) return true;
	const tag = t.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
	if (t.isContentEditable) return false;
	return true;
}

export default function PasteActions({
	pasteId,
	pasteTitle,
	pasteLanguage,
	isEncrypted,
	getDecryptedContent,
	getRawContent,
}: PasteActionsProps) {
	const [showPanel, setShowPanel] = useState<'none' | 'qr' | 'embed'>('none');
	const [hasEditToken, setHasEditToken] = useState(false);
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [qrError, setQrError] = useState<string | null>(null);

	useEffect(() => {
		setHasEditToken(hasPasteToken(pasteId));
	}, [pasteId]);

	// Render QR locally on demand. Dynamic import keeps `qrcode` out of the
	// initial bundle — most viewers never open the QR panel.
	useEffect(() => {
		if (showPanel !== 'qr' || qrDataUrl) return;
		let cancelled = false;
		(async () => {
			try {
				const QRCode = (await import('qrcode')).default;
				const url = await QRCode.toDataURL(window.location.href, {
					errorCorrectionLevel: 'M',
					margin: 2,
					width: 220,
				});
				if (!cancelled) setQrDataUrl(url);
			} catch (err) {
				if (!cancelled) {
					setQrError(err instanceof Error ? err.message : 'QR generation failed');
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [showPanel, qrDataUrl]);

	const getContent = () => {
		const text = isEncrypted ? getDecryptedContent() : getRawContent();
		if (!text && isEncrypted) {
			toast({ message: 'Still decrypting…', type: 'info', duration: 2000 });
		}
		return text;
	};

	const handleViewRaw = () => {
		if (isEncrypted) {
			const text = getContent();
			if (text) {
				const blob = new Blob([text], { type: 'text/plain' });
				const url = URL.createObjectURL(blob);
				window.open(url, '_blank');
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			}
		} else {
			window.open(`/pastes/raw/${pasteId}`, '_blank');
		}
	};

	const handleCopy = async () => {
		const text = getContent();
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			toast({ message: 'Copied!', type: 'success', duration: 2000 });
		} catch {
			toast({ message: 'Failed to copy.', type: 'error', duration: 3000 });
		}
	};

	const handleDownload = () => {
		const text = getContent();
		if (!text) return;
		const ext = pasteLanguage ? (LANG_EXT[pasteLanguage] || 'txt') : 'txt';
		const filename = `${pasteTitle || 'paste'}.${ext}`;
		const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 100);
		toast({ message: `Downloaded ${filename}`, type: 'success', duration: 2000 });
	};

	const handleFork = () => {
		const text = getContent();
		if (!text) return;
		sessionStorage.setItem('pasteriser_fork', JSON.stringify({
			content: text,
			title: pasteTitle ? `Fork of ${pasteTitle}` : undefined,
			language: pasteLanguage,
		}));
		window.location.href = '/';
	};

	const handleEdit = async () => {
		const text = getContent();
		if (!text) return;
		const token = await loadPasteToken(pasteId);
		sessionStorage.setItem('pasteriser_edit', JSON.stringify({
			pasteId,
			content: text,
			title: pasteTitle,
			language: pasteLanguage,
			token,
		}));
		window.location.href = '/';
	};

	const handleDelete = async () => {
		const confirmed = await showConfirmModal({
			title: 'Delete paste',
			description: 'This action cannot be undone.',
			confirmText: 'Delete',
			cancelText: 'Cancel',
			isDangerous: true,
		});
		if (confirmed) {
			try {
				const token = await loadPasteToken(pasteId);
				if (token) sessionStorage.setItem('pasteriser_delete_token', token);
			} catch { /* ignore */ }
			window.location.href = `/pastes/${pasteId}/delete`;
		}
	};

	const handleNew = () => {
		window.location.href = '/';
	};

	// ── Keyboard shortcuts ─────────────────────────────────────────
	//
	// Handlers close over `getDecryptedContent` (a prop) which is recreated
	// each render by PasteViewer to read the latest `decryptedContent`
	// state. If we bound the listener once and the handlers eagerly, the
	// captured closure would forever call the FIRST render's
	// `getDecryptedContent` — returning null even after auto-decrypt
	// completed. To stay live: every render writes the current handlers
	// (and the conditional flags they read) into a ref, and `onKey` looks
	// them up on each keypress.
	const liveRef = useRef({
		hasEditToken,
		isEncrypted,
		handleCopy,
		handleViewRaw,
		handleDownload,
		handleNew,
		handleFork,
		handleEdit,
		handleDelete,
		setShowPanel,
	});
	useEffect(() => {
		liveRef.current = {
			hasEditToken,
			isEncrypted,
			handleCopy,
			handleViewRaw,
			handleDownload,
			handleNew,
			handleFork,
			handleEdit,
			handleDelete,
			setShowPanel,
		};
	});

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (!shouldHandleShortcut(e)) return;
			const key = e.key.toLowerCase();
			const live = liveRef.current;
			switch (key) {
				case 'c': e.preventDefault(); live.handleCopy(); break;
				case 'r': e.preventDefault(); live.handleViewRaw(); break;
				case 's': e.preventDefault(); live.handleDownload(); break;
				case 'n': e.preventDefault(); live.handleNew(); break;
				case 'f': e.preventDefault(); live.handleFork(); break;
				case 'q': e.preventDefault(); live.setShowPanel((p) => (p === 'qr' ? 'none' : 'qr')); break;
				case 'e':
					if (live.hasEditToken) { e.preventDefault(); live.handleEdit(); }
					break;
				case 'm':
					if (!live.isEncrypted) { e.preventDefault(); live.setShowPanel((p) => (p === 'embed' ? 'none' : 'embed')); }
					break;
				case 'x':
					if (e.shiftKey) { e.preventDefault(); live.handleDelete(); }
					break;
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	const rawUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/pastes/raw/${pasteId}`;
	const embedSnippet = `<iframe src="${rawUrl}" style="width:100%;height:400px;border:1px solid #ccc;" sandbox="allow-same-origin"></iframe>`;
	const scriptSnippet = `<script src="${rawUrl}" defer><\/script>`;

	return (
		<div className="mt-3 animate-fade-in">
			{/* ── Action bar — single row, text labels, key hints ── */}
			<div className="border border-border bg-card">
				<div className="border-b border-border px-3 py-1 bg-card-alt flex items-center justify-between">
					<span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
						Actions
					</span>
					<span className="text-[10px] uppercase tracking-wide text-muted-foreground hidden sm:inline">
						Shortcuts: <kbd>c</kbd>opy <kbd>r</kbd>aw <kbd>s</kbd>ave <kbd>n</kbd>ew <kbd>f</kbd>ork <kbd>q</kbd>r{hasEditToken && <> <kbd>e</kbd>dit</>}{!isEncrypted && <> e<kbd>m</kbd>bed</>} <kbd>shift+x</kbd> delete
					</span>
				</div>
				<div className="px-2 py-1.5 flex flex-wrap items-center gap-1">
					<ActionButton onClick={handleCopy} hint="c">Copy</ActionButton>
					<ActionButton onClick={handleViewRaw} hint="r">Raw</ActionButton>
					<ActionButton onClick={handleDownload} hint="s">Download</ActionButton>
					<ActionButton onClick={handleNew} hint="n">New</ActionButton>
					{hasEditToken && <ActionButton onClick={handleEdit} hint="e">Edit</ActionButton>}
					<ActionButton onClick={handleFork} hint="f">Fork</ActionButton>
					<ActionButton onClick={() => setShowPanel(showPanel === 'qr' ? 'none' : 'qr')} hint="q" active={showPanel === 'qr'}>QR</ActionButton>
					{!isEncrypted && (
						<ActionButton onClick={() => setShowPanel(showPanel === 'embed' ? 'none' : 'embed')} hint="m" active={showPanel === 'embed'}>Embed</ActionButton>
					)}
					<span className="flex-1" />
					<button
						type="button"
						onClick={handleDelete}
						className="btn h-7 px-2 text-xs border border-destructive bg-card text-destructive hover:bg-destructive hover:text-destructive-foreground inline-flex items-center gap-1.5"
					>
						<span>Delete</span>
						<kbd className="text-[10px]">⇧x</kbd>
					</button>
				</div>
			</div>

			{/* ── QR Code panel ───────────────────────────────────── */}
			{showPanel === 'qr' && (
				<div className="mt-2 border border-border bg-card animate-fade-in">
					<div className="border-b border-border px-3 py-1 bg-card-alt flex items-center justify-between">
						<span className="text-[10px] uppercase tracking-wide font-semibold">QR code — share URL</span>
						<button
							onClick={() => setShowPanel('none')}
							className="text-xs text-muted-foreground hover:text-foreground"
							aria-label="Close"
						>
							[×]
						</button>
					</div>
					<div className="px-3 py-3 flex flex-col items-center gap-2">
						{qrError && <p className="text-xs text-destructive">QR error: {qrError}</p>}
						{!qrError && qrDataUrl && (
							<img
								src={qrDataUrl}
								alt="QR Code"
								width={220}
								height={220}
								className="bg-white p-2 border border-border-strong"
							/>
						)}
						{!qrError && !qrDataUrl && (
							<div className="h-[220px] w-[220px] bg-muted" aria-label="Generating QR code" />
						)}
						<p className="text-xs text-muted-foreground">Scan to open this paste</p>
					</div>
				</div>
			)}

			{/* ── Embed panel ─────────────────────────────────────── */}
			{showPanel === 'embed' && (
				<div className="mt-2 border border-border bg-card animate-fade-in">
					<div className="border-b border-border px-3 py-1 bg-card-alt flex items-center justify-between">
						<span className="text-[10px] uppercase tracking-wide font-semibold">Embed snippets</span>
						<button
							onClick={() => setShowPanel('none')}
							className="text-xs text-muted-foreground hover:text-foreground"
							aria-label="Close"
						>
							[×]
						</button>
					</div>
					<div className="px-3 py-3 space-y-3">
						<div>
							<label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1 block">iframe</label>
							<div className="flex items-stretch border border-border bg-card-alt">
								<code className="flex-1 px-2 py-1 text-xs font-mono overflow-x-auto whitespace-nowrap">{embedSnippet}</code>
								<button
									className="btn px-2 border-l border-border text-xs uppercase tracking-wide hover:bg-muted"
									onClick={() => {
										navigator.clipboard.writeText(embedSnippet);
										toast({ message: 'Embed copied!', type: 'success', duration: 2000 });
									}}
								>
									Copy
								</button>
							</div>
						</div>

						<div>
							<label className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1 block">Script tag (raw)</label>
							<div className="flex items-stretch border border-border bg-card-alt">
								<code className="flex-1 px-2 py-1 text-xs font-mono overflow-x-auto whitespace-nowrap">{scriptSnippet}</code>
								<button
									className="btn px-2 border-l border-border text-xs uppercase tracking-wide hover:bg-muted"
									onClick={() => {
										navigator.clipboard.writeText(scriptSnippet);
										toast({ message: 'Script tag copied!', type: 'success', duration: 2000 });
									}}
								>
									Copy
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Individual action button with key hint ──────────────────────────
function ActionButton({
	children,
	hint,
	onClick,
	active,
	className,
}: {
	children: React.ReactNode;
	hint?: string;
	onClick: () => void;
	active?: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'btn h-7 px-2 text-xs border inline-flex items-center gap-1.5',
				active
					? 'border-primary-hover bg-primary text-primary-foreground'
					: 'border-input bg-card text-foreground hover:bg-primary hover:border-primary hover:text-primary-foreground',
				className,
			)}
		>
			<span>{children}</span>
			{hint && <kbd className="text-[10px]">{hint}</kbd>}
		</button>
	);
}
