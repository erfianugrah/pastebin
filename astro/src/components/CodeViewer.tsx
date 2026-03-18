import { useState, useEffect, useRef } from 'react';
import { Lock, Unlock, Flame, Eye, Clock, KeyRound, ShieldCheck } from 'lucide-react';
import { decryptData, deriveKeyFromPassword } from '../lib/crypto';
import { toast } from './ui/toast';
import { Button } from './ui/button';
import util from 'tweetnacl-util';
import { ExpirationCountdown } from './ExpirationCountdown';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { ErrorDisplay } from './ui/error-display';
import { ErrorCategory } from '../lib/errorTypes';
import { cn } from '../lib/utils';
import { T } from '../lib/typography';

// Import Prism core (autoloader configured lazily to avoid SSG crash)
import Prism from 'prismjs';

if (typeof window !== 'undefined') {
	// @ts-expect-error -- prism autoloader plugin has no type declarations
	import('prismjs/plugins/autoloader/prism-autoloader').then(() => {
		Prism.plugins.autoloader.languages_path = '/prism-components/';
	});
}

const { decodeBase64 } = util;
const isDev = typeof window !== 'undefined' && window.location?.hostname === 'localhost';

declare global {
	interface Window {
		Prism: { highlightElement: (element: HTMLElement) => void };
	}
}

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

interface SessionInfo { eventName: string; token: string }
interface CodeViewerProps {
	paste: PasteData;
	/** @deprecated Use onDecrypted instead. Kept for legacy [id].astro compat. */
	sessionInfo?: SessionInfo;
	/** Called when content has been successfully decrypted. */
	onDecrypted?: (content: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString('en-US', {
		year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
	});
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
	return <span className={cn('badge', className)}>{children}</span>;
}

type FileEntry = { name: string; content: string; language?: string };

/** Minimal markdown to HTML renderer (no dependencies). */
function renderMarkdown(md: string): string {
	let html = md
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		// headings
		.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
		.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
		.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
		.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
		.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
		.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
		// bold, italic, code
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/\*(.+?)\*/g, '<em>$1</em>')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		// links
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
		// horizontal rule
		.replace(/^---$/gm, '<hr />')
		// unordered lists
		.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
		// paragraphs (double newline)
		.replace(/\n\n/g, '</p><p>')
		// single newlines
		.replace(/\n/g, '<br />');
	// Wrap list items
	html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');
	return `<p>${html}</p>`;
}

// ── Component ────────────────────────────────────────────────────────

export default function CodeViewer({ paste, sessionInfo, onDecrypted }: CodeViewerProps) {
	const [content, setContent] = useState<string>(paste.content);
	const [isDecrypting, setIsDecrypting] = useState(false);
	const [decrypted, setDecrypted] = useState(false);
	const [decryptionProgress, setDecryptionProgress] = useState<number | null>(null);
	const [passwordInput, setPasswordInput] = useState('');
	const [showPasswordForm, setShowPasswordForm] = useState(false);
	const [showRendered, setShowRendered] = useState(false);
	const [activeFileIdx, setActiveFileIdx] = useState(0);
	const codeRef = useRef<HTMLElement>(null);

	const isMarkdown = paste.language === 'markdown';

	// Multi-file detection: language === '_multi' and content is JSON array
	const isMultiFile = paste.language === '_multi';
	const [parsedFiles, setParsedFiles] = useState<FileEntry[]>([]);

	// Parse multi-file content when available
	useEffect(() => {
		const raw = (!paste.isEncrypted || decrypted) ? content : null;
		if (isMultiFile && raw) {
			try { setParsedFiles(JSON.parse(raw) as FileEntry[]); } catch { /* not valid JSON */ }
		}
	}, [content, decrypted, isMultiFile]);

	const activeFile = parsedFiles[activeFileIdx] ?? parsedFiles[0];

	const { error, errorMessage, category, handleError } = useErrorHandler();

	// ── Notify parent ────────────────────────────────────────────────
	const notifyDecrypted = (decryptedContent: string) => {
		onDecrypted?.(decryptedContent);
		// Legacy event for [id].astro backward compat
		if (sessionInfo) {
			window.dispatchEvent(new CustomEvent(sessionInfo.eventName, {
				detail: { content: decryptedContent, token: sessionInfo.token },
			}));
		}
	};

	// ── Syntax highlighting ──────────────────────────────────────────
	useEffect(() => {
		if ((!paste.isEncrypted || decrypted) && codeRef.current) {
			Prism.highlightElement(codeRef.current);
		}
	}, [content, decrypted, paste.language, paste.isEncrypted]);

	// ── Auto-decryption on mount ─────────────────────────────────────
	useEffect(() => {
		if (!paste.isEncrypted || decrypted) return;

		async function attemptDecryption() {
			try {
				setIsDecrypting(true);

				// 1. Try URL fragment key
				let key = extractKeyFromUrl();

				// 2. Try saved key
				let savedKey: string | null = null;
				if (!key && paste.id) {
					try {
						const { secureRetrieve } = await import('../lib/secureStorage');
						savedKey = await secureRetrieve(`paste_key_${paste.id}`);
					} catch {
						savedKey = localStorage.getItem(`paste_key_${paste.id}`);
					}
				}

				const keyToUse = key || savedKey;

				if (keyToUse) {
					await performDecryption(keyToUse, false);

					if (key && paste.id) {
						try {
							const { secureStore } = await import('../lib/secureStorage');
							await secureStore(`paste_key_${paste.id}`, key);
						} catch { /* ignore storage failures */ }
					}
				} else {
					// No key — check if password-protected
					try {
						const data = decodeBase64(paste.content);
						if (data.length > 40) {
							setShowPasswordForm(true);
							toast({ message: 'This paste is password-protected.', type: 'info', duration: 4000 });
						} else {
							toast({ message: 'Decryption key required.', type: 'info', duration: 4000 });
						}
					} catch {
						toast({ message: 'Decryption key required.', type: 'info', duration: 4000 });
					}
				}
			} catch (error) {
				if (isDev) console.error('Decryption error:', error);
			} finally {
				setIsDecrypting(false);
			}
		}

		attemptDecryption();
	}, [paste.content, paste.id, paste.isEncrypted, decrypted]);

	// ── Extract key from URL #key=... ────────────────────────────────
	function extractKeyFromUrl(): string | null {
		const hash = window.location.hash.substring(1);
		if (!hash) return null;

		const match = hash.match(/key=([^&]+)/);
		let key = match?.[1] ?? null;
		if (!key) {
			const params = new URLSearchParams(hash);
			key = params.get('key');
			if (key) key = key.replace(/ /g, '+');
		}
		if (!key) return null;

		try {
			if (key.includes('%')) key = decodeURIComponent(key);
			if (key.includes(' ')) key = key.replace(/ /g, '+');
			key = key.replace(/%2B/g, '+').replace(/%2F/g, '/').replace(/%3D/g, '=');
		} catch { /* keep original */ }

		return key;
	}

	// ── Core decryption logic ────────────────────────────────────────
	async function performDecryption(keyOrPassword: string, isPassword: boolean) {
		setDecryptionProgress(0);

		const estimatedTime = Math.max(2000, Math.min(paste.content.length / 1000, 30000));
		const startTime = Date.now();
		const progressInterval = setInterval(() => {
			const elapsed = Date.now() - startTime;
			const progress = Math.min(95, Math.floor((elapsed / estimatedTime) * 100));
			setDecryptionProgress(progress);
		}, 50);

		try {
			const decryptedContent = await decryptData(paste.content, keyOrPassword, isPassword);
			setDecryptionProgress(100);
			setContent(decryptedContent);
			setDecrypted(true);
			notifyDecrypted(decryptedContent);
			toast({ message: 'Decrypted successfully', type: 'success' });
		} catch (error) {
			handleError(error, { location: 'CodeViewer.performDecryption', pasteId: paste.id });

			if (!isPassword) {
				// Key failed — might need password
				setShowPasswordForm(true);
				toast({ message: 'Key failed. Try a password instead.', type: 'error' });
			} else {
				toast({ message: 'Invalid password.', type: 'error' });
				setShowPasswordForm(true);
			}

			// Remove invalid saved key
			if (!isPassword && paste.id) {
				try {
					const { secureRemove } = await import('../lib/secureStorage');
					secureRemove(`paste_key_${paste.id}`);
					localStorage.removeItem(`paste_key_${paste.id}`);
				} catch { /* ignore */ }
			}
		} finally {
			clearInterval(progressInterval);
			setDecryptionProgress(null);
		}
	}

	// ── Password submit ──────────────────────────────────────────────
	async function handlePasswordSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!passwordInput.trim()) return;
		setIsDecrypting(true);
		setShowPasswordForm(false);

		try {
			await performDecryption(passwordInput, true);

			// Offer to save password-derived key
			const { showConfirmModal } = await import('./ui/modal');
			const save = await showConfirmModal({
				title: 'Save password?',
				description: 'Save the decryption key in your browser for future visits?',
				confirmText: 'Save',
				cancelText: 'No thanks',
			});

			if (save && paste.id) {
				try {
					const { key, salt } = await deriveKeyFromPassword(passwordInput);
					const { secureStore } = await import('../lib/secureStorage');
					await secureStore(`paste_key_${paste.id}`, `dk:${salt}:${key}`);
					toast({ message: 'Password saved for this paste.', type: 'success', duration: 2000 });
				} catch { /* ignore */ }
			}
		} finally {
			setIsDecrypting(false);
		}
	}

	// ── Render ────────────────────────────────────────────────────────

	return (
		<div className="w-full">
			{/* ── Metadata ───────────────────────────────────────── */}
			<div className="mb-4 pb-4 border-b border-border">
				<h2 className={cn(T.pasteTitle, 'mb-2')}>{paste.title || 'Untitled Paste'}</h2>

				<div className={T.metaRow}>
					<span>{formatDate(paste.createdAt)}</span>
					<span className="text-border">|</span>
					<ExpirationCountdown expiresAt={paste.expiresAt} />

					{paste.language && (
						<Badge className="bg-muted text-muted-foreground">{paste.language}</Badge>
					)}

					{paste.isEncrypted && (
						<Badge className={decrypted
							? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
							: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
						}>
							{decrypted ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
							{decrypted ? 'Decrypted' : 'Encrypted'}
						</Badge>
					)}

					{paste.burnAfterReading && (
						<Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
							<Flame className="h-3 w-3" /> Self-destruct
						</Badge>
					)}

					{paste.hasViewLimit && (
						<Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
							<Eye className="h-3 w-3" />
							{paste.remainingViews === 1 ? 'Final view' : `${paste.remainingViews} views left`}
						</Badge>
					)}
				</div>
			</div>

			{/* ── Single warning bar (burn OR view limit, not both boxes) */}
			{(paste.burnAfterReading || (paste.hasViewLimit && paste.remainingViews && paste.remainingViews <= 3)) && (
				<div className={cn(
					'flex items-center gap-2 rounded-lg p-3 mb-4 text-sm',
					paste.remainingViews === 1 || paste.burnAfterReading
						? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
						: 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
				)}>
					{paste.burnAfterReading
						? <><Flame className="h-4 w-4 shrink-0" /> This paste will be deleted after you leave this page.</>
						: <><Eye className="h-4 w-4 shrink-0" /> {paste.remainingViews} view{paste.remainingViews !== 1 ? 's' : ''} remaining before deletion.</>
					}
				</div>
			)}

			{/* ── Error display ───────────────────────────────────── */}
			{error && category === ErrorCategory.CRYPTO && !isDecrypting && (
				<ErrorDisplay
					message={errorMessage || 'Decryption error'}
					category={ErrorCategory.CRYPTO}
					retry={() => window.location.reload()}
					details={isDev ? error.stack : undefined}
				/>
			)}

			{/* ── Decryption progress ─────────────────────────────── */}
			{isDecrypting && (
				<div className="flex flex-col items-center justify-center py-12">
					{decryptionProgress !== null ? (
						<div className="w-full max-w-xs">
							<div className="flex justify-between text-xs text-muted-foreground mb-1">
								<span>Decrypting...</span>
								<span>{decryptionProgress}%</span>
							</div>
							<div className="w-full bg-muted rounded-full h-1.5" role="progressbar" aria-valuenow={decryptionProgress} aria-valuemin={0} aria-valuemax={100}>
								<div className="bg-primary h-1.5 rounded-full transition-all duration-200" style={{ width: `${decryptionProgress}%` }} />
							</div>
						</div>
					) : (
						<div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" role="status" aria-label="Decrypting" />
					)}
				</div>
			)}

			{/* ── Locked state (replaces blurred base64) ──────────── */}
			{paste.isEncrypted && !decrypted && !isDecrypting && !showPasswordForm && (
				<div className="flex flex-col items-center justify-center py-16 text-center">
					<div className="rounded-full bg-muted p-4 mb-4">
						<Lock className="h-8 w-8 text-muted-foreground" />
					</div>
					<h3 className={T.emptyTitle}>Encrypted Content</h3>
					<p className={T.emptyDescription}>
						This paste requires a decryption key or password. Make sure the URL includes the key after&nbsp;#.
					</p>
					<div className="flex gap-3">
						<Button size="sm" onClick={() => setShowPasswordForm(true)}>
							<KeyRound className="h-4 w-4 mr-1.5" /> Enter Password
						</Button>
						<Button size="sm" variant="outline" asChild>
							<a href="/">Back to Home</a>
						</Button>
					</div>
				</div>
			)}

			{/* ── Code content (only when viewable) ───────────────── */}
			{(!paste.isEncrypted || decrypted) && !isDecrypting && (
				<div>
					{/* Multi-file tabs */}
					{isMultiFile && parsedFiles.length > 0 && (
						<div className="flex items-center gap-1 mb-2 overflow-x-auto border-b border-border">
							{parsedFiles.map((f, i) => (
								<button
									key={i}
									type="button"
									onClick={() => setActiveFileIdx(i)}
									className={cn(
										'px-3 py-1.5 text-xs rounded-t-md transition-colors whitespace-nowrap border border-b-0',
										activeFileIdx === i
											? 'bg-card border-border text-foreground -mb-px'
											: 'bg-transparent border-transparent text-muted-foreground hover:text-foreground',
									)}
								>
									{f.name || `file ${i + 1}`}
								</button>
							))}
						</div>
					)}

					{/* Markdown toggle */}
					{(isMarkdown || (isMultiFile && activeFile?.language === 'markdown')) && (
						<div className="flex gap-1 mb-2">
							<button
								type="button"
								onClick={() => setShowRendered(false)}
								className={cn('px-3 py-1 text-xs rounded-md transition-colors', !showRendered ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
							>
								Code
							</button>
							<button
								type="button"
								onClick={() => setShowRendered(true)}
								className={cn('px-3 py-1 text-xs rounded-md transition-colors', showRendered ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
							>
								Preview
							</button>
						</div>
					)}

					{/* Rendered markdown */}
					{showRendered && (isMarkdown || activeFile?.language === 'markdown') ? (
						<div
							className="prose prose-sm dark:prose-invert max-w-none p-4 rounded-lg border border-border bg-card overflow-auto max-h-[600px]"
							dangerouslySetInnerHTML={{ __html: renderMarkdown(isMultiFile ? (activeFile?.content || '') : content) }}
						/>
					) : (
						<pre className="p-4 rounded-lg border border-border overflow-x-auto overflow-y-auto font-mono text-sm max-h-[600px] bg-card line-numbers">
							<code ref={codeRef} className={`language-${isMultiFile ? (activeFile?.language || 'plaintext') : (paste.language || 'plaintext')}`}>
								{isMultiFile ? (activeFile?.content || '') : content}
							</code>
						</pre>
					)}
				</div>
			)}

			{/* ── Password form ───────────────────────────────────── */}
			{paste.isEncrypted && !decrypted && showPasswordForm && !isDecrypting && (
				<div className="max-w-sm mx-auto mt-4 p-6 rounded-lg border border-border bg-card">
					<div className="flex items-center gap-2 mb-4">
						<Lock className="h-5 w-5 text-muted-foreground" />
						<h3 className="font-semibold">Password Required</h3>
					</div>
					<p className={cn(T.mutedSm, 'mb-4')}>Decryption happens locally in your browser.</p>

					<form onSubmit={handlePasswordSubmit} className="space-y-3">
						<input
							type="password"
							value={passwordInput}
							onChange={(e) => setPasswordInput(e.target.value)}
							className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							placeholder="Enter password"
							autoComplete="current-password"
							autoFocus
							required
						/>
						<div className="flex gap-2">
							<Button type="submit" size="sm" disabled={!passwordInput.trim()} className="flex-1">Decrypt</Button>
							<Button type="button" size="sm" variant="ghost" onClick={() => setShowPasswordForm(false)}>Cancel</Button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
}
