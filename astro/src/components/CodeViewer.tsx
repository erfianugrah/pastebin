import { useState, useEffect, useRef } from 'react';
import { decryptData } from '../lib/crypto';
import { toast } from './ui/toast';
import { Button } from './ui/button';
import util from 'tweetnacl-util';
import { ExpirationCountdown } from './ExpirationCountdown';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { ErrorDisplay } from './ui/error-display';
import { ErrorCategory } from '../lib/errorTypes';
import { cn } from '../lib/utils';
import { T } from '../lib/typography';
import { renderMarkdown } from '../lib/markdown';
import { detectImage, formatBytes } from '../lib/codeViewerHelpers';

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

// ── View-mode toggle button ──────────────────────────────────────────
// Used in the toolbar above the code block. Active state = yellow.
function ModeButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'px-3 py-1 text-[10px] uppercase tracking-wide font-semibold border-r border-border',
				active
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground hover:text-foreground hover:bg-muted',
			)}
		>
			{children}
		</button>
	);
}

type FileEntry = { name: string; content: string; language?: string };

// View mode toggled via the view-mode toolbar. 'source' is the default.
// 'rendered' only available for markdown. 'image' only when content
// resolves to a data URI / web URL pointing at an image.
type ViewMode = 'source' | 'rendered' | 'image';

const WRAP_STORAGE_KEY = 'pasteriser_wrap';

// renderMarkdown lives in ../lib/markdown.ts — marked v18 + DOMPurify v3 with
// custom renderers (Prism-compatible fenced blocks, heading slugs, task lists,
// external-link rel/target, table wrapper, [[kbd]] extension).

// ── Component ────────────────────────────────────────────────────────

export default function CodeViewer({ paste, sessionInfo, onDecrypted }: CodeViewerProps) {
	const [content, setContent] = useState<string>(paste.content);
	const [isDecrypting, setIsDecrypting] = useState(false);
	const [decrypted, setDecrypted] = useState(false);
	const [decryptionProgress, setDecryptionProgress] = useState<number | null>(null);
	const [passwordInput, setPasswordInput] = useState('');
	const [showPasswordForm, setShowPasswordForm] = useState(false);
	const [viewMode, setViewMode] = useState<ViewMode>('source');
	const [wrap, setWrap] = useState<boolean>(() => {
		if (typeof window === 'undefined') return false;
		try { return localStorage.getItem(WRAP_STORAGE_KEY) === '1'; } catch { return false; }
	});
	const [activeFileIdx, setActiveFileIdx] = useState(0);
	const codeRef = useRef<HTMLElement>(null);
	const proseRef = useRef<HTMLDivElement>(null);

	const isMarkdown = paste.language === 'markdown';

	// Multi-file detection: language === '_multi' and content is JSON array
	const isMultiFile = paste.language === '_multi';
	const [parsedFiles, setParsedFiles] = useState<FileEntry[]>([]);

	// Persist wrap preference
	useEffect(() => {
		try { localStorage.setItem(WRAP_STORAGE_KEY, wrap ? '1' : '0'); } catch { /* ignore */ }
	}, [wrap]);

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

	// Re-highlight fenced code blocks inside rendered markdown after each render.
	useEffect(() => {
		if (viewMode !== 'rendered' || !proseRef.current) return;
		proseRef.current.querySelectorAll<HTMLElement>('pre > code[class*="language-"]').forEach((el) => {
			Prism.highlightElement(el);
		});
	}, [viewMode, content, activeFileIdx, decrypted]);

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
	//
	// Previously this offered a "save password" confirmation that stored
	// `dk:<salt>:<key>` in secureStorage. On revisit, the auto-decrypt
	// path read that value back and passed the raw string straight into
	// `performDecryption(value, /*isPassword*/ false)`, which tried to
	// decode `"dk:..."` as base64 and failed every time. The feature
	// silently never worked. Removed — users keep typing the password.
	async function handlePasswordSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!passwordInput.trim()) return;
		setIsDecrypting(true);
		setShowPasswordForm(false);

		try {
			await performDecryption(passwordInput, true);
		} finally {
			setIsDecrypting(false);
		}
	}

	// ── Render ────────────────────────────────────────────────────────

	const contentBytes = new TextEncoder().encode(content).length;

	return (
		<div className="w-full animate-fade-in">
			{/* ── Title + definition-list metadata ──────────────────── */}
			<div className="mb-3 pb-3 border-b border-border-strong">
				<h1 className={cn(T.pasteTitle, 'mb-2')}>{paste.title || 'Untitled paste'}</h1>

				<dl className="dl-inline">
					<dt>ID</dt><dd className="font-mono">{paste.id.slice(0, 8)}…</dd>
					<span className="sep">·</span>
					<dt>Created</dt><dd>{formatDate(paste.createdAt)}</dd>
					<span className="sep">·</span>
					<dt>Expires</dt><dd><ExpirationCountdown expiresAt={paste.expiresAt} /></dd>
					{paste.language && (
						<>
							<span className="sep">·</span>
							<dt>Lang</dt><dd>{paste.language}</dd>
						</>
					)}
					{!paste.isEncrypted && (
						<>
							<span className="sep">·</span>
							<dt>Size</dt><dd className="font-mono">{formatBytes(contentBytes)}</dd>
						</>
					)}
					{paste.visibility === 'private' && (
						<>
							<span className="sep">·</span>
							<dt>Vis</dt><dd>private</dd>
						</>
					)}
					{paste.isEncrypted && (
						<>
							<span className="sep">·</span>
							<dt>E2EE</dt>
							<dd className={decrypted ? 'text-success' : 'text-warning'}>
								{decrypted ? 'decrypted' : 'encrypted'}
							</dd>
						</>
					)}
					{paste.burnAfterReading && (
						<>
							<span className="sep">·</span>
							<dt>Burn</dt><dd className="text-destructive">yes</dd>
						</>
					)}
					{paste.hasViewLimit && (
						<>
							<span className="sep">·</span>
							<dt>Views</dt>
							<dd className="text-warning font-mono">
								{paste.remainingViews}/{paste.viewLimit}
							</dd>
						</>
					)}
				</dl>
			</div>

			{/* ── Single warning bar (burn OR view limit) ──────────── */}
			{(paste.burnAfterReading || (paste.hasViewLimit && paste.remainingViews && paste.remainingViews <= 3)) && (
				<div className={cn(
					'notice mb-3',
					paste.remainingViews === 1 || paste.burnAfterReading
						? 'notice-destructive'
						: 'notice-warning',
				)}>
					<span className="font-bold uppercase tracking-wide text-xs shrink-0">
						{paste.burnAfterReading ? 'BURN' : `${paste.remainingViews} LEFT`}
					</span>
					<span className="text-xs">
						{paste.burnAfterReading
							? 'This paste will be deleted after you leave this page.'
							: `${paste.remainingViews} view${paste.remainingViews !== 1 ? 's' : ''} remaining before deletion.`}
					</span>
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
				<div className="border border-border bg-card px-4 py-6 mb-3">
					{decryptionProgress !== null ? (
						<div className="w-full max-w-xs mx-auto">
							<div className="flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
								<span>Decrypting…</span>
								<span className="font-mono">{decryptionProgress}%</span>
							</div>
							<div className="w-full bg-muted h-1" role="progressbar" aria-valuenow={decryptionProgress} aria-valuemin={0} aria-valuemax={100}>
								<div className="bg-primary h-1" style={{ width: `${decryptionProgress}%` }} />
							</div>
						</div>
					) : (
						<p className="text-center text-xs text-muted-foreground">Decrypting…</p>
					)}
				</div>
			)}

			{/* ── Locked state (no key supplied) ──────────────────── */}
			{paste.isEncrypted && !decrypted && !isDecrypting && !showPasswordForm && (
				<div className="border border-warning bg-card mb-3">
					<div className="border-b border-warning px-3 py-1.5 bg-card-alt">
						<span className="text-xs font-bold uppercase tracking-wide text-warning">
							⚠ Encrypted — key required
						</span>
					</div>
					<div className="px-3 py-3 space-y-3">
						<p className="text-sm">
							This paste requires a decryption key or password. Confirm the URL includes the key after{' '}
							<code className="font-mono">#</code>, or enter a password below.
						</p>
						<div className="flex gap-2">
							<Button variant="primary" size="sm" onClick={() => setShowPasswordForm(true)}>
								Enter password
							</Button>
							<Button size="sm" asChild>
								<a href="/" className="no-underline">Home</a>
							</Button>
						</div>
					</div>
				</div>
			)}

			{/* ── Code content (only when viewable) ───────────────── */}
			{(!paste.isEncrypted || decrypted) && !isDecrypting && (() => {
				// Active content for whichever file/single-paste is showing
				const activeContent = isMultiFile ? (activeFile?.content || '') : content;
				const activeLanguage = isMultiFile ? (activeFile?.language || 'plaintext') : (paste.language || 'plaintext');
				const activeIsMarkdown = activeLanguage === 'markdown';
				const imageSrc = !activeIsMarkdown ? detectImage(activeContent) : null;

				// Effective view mode — collapse to 'source' when the user picked
				// a mode that isn't available for this content (e.g. they had
				// 'rendered' set, then switched files to a non-markdown one).
				const effectiveMode: ViewMode =
					(viewMode === 'rendered' && !activeIsMarkdown) ||
					(viewMode === 'image' && !imageSrc)
						? 'source'
						: viewMode;

				return (
					<div>
						{/* Multi-file tabs */}
						{isMultiFile && parsedFiles.length > 0 && (
							<div className="flex items-stretch gap-px overflow-x-auto bg-border">
								{parsedFiles.map((f, i) => (
									<button
										key={i}
										type="button"
										onClick={() => setActiveFileIdx(i)}
										className={cn(
											'px-3 py-1 text-xs whitespace-nowrap font-mono',
											activeFileIdx === i
												? 'bg-card text-foreground'
												: 'bg-card-alt text-muted-foreground hover:text-foreground',
										)}
									>
										{f.name || `file ${i + 1}`}
									</button>
								))}
							</div>
						)}

						{/* ── View-mode toolbar ─────────────────────────────────
						    Always shows Source. Adds Rendered when content is
						    markdown, Image when content is one image. Wrap toggle
						    on the right (source view only). */}
						<div className="flex items-stretch border border-border bg-card-alt overflow-x-auto">
							<ModeButton active={effectiveMode === 'source'} onClick={() => setViewMode('source')}>
								Source
							</ModeButton>
							{activeIsMarkdown && (
								<ModeButton active={effectiveMode === 'rendered'} onClick={() => setViewMode('rendered')}>
									Rendered
								</ModeButton>
							)}
							{imageSrc && (
								<ModeButton active={effectiveMode === 'image'} onClick={() => setViewMode('image')}>
									Image
								</ModeButton>
							)}
							<span className="flex-1" />
							{effectiveMode === 'source' && (
								<label className="flex items-center gap-1.5 px-2 text-[10px] uppercase tracking-wide font-semibold border-l border-border cursor-pointer hover:bg-muted">
									<input
										type="checkbox"
										checked={wrap}
										onChange={(e) => setWrap(e.target.checked)}
										className="form-checkbox h-3 w-3 border border-border-strong bg-card checked:bg-primary checked:border-primary-hover"
									/>
									Wrap
								</label>
							)}
						</div>

						{/* ── Image view ──────────────────────────────────── */}
						{effectiveMode === 'image' && imageSrc && (
							<div className="border border-border border-t-0 bg-card p-3 flex items-center justify-center overflow-auto max-h-[640px]">
								<img
									src={imageSrc}
									alt="Paste preview"
									className="max-w-full max-h-[600px] object-contain"
								/>
							</div>
						)}

						{/* ── Markdown rendered ───────────────────────────── */}
						{effectiveMode === 'rendered' && activeIsMarkdown && (
							<div
								ref={proseRef}
								className="prose max-w-none p-4 border border-border border-t-0 bg-card overflow-auto max-h-[640px]"
								dangerouslySetInnerHTML={{ __html: renderMarkdown(activeContent) }}
							/>
						)}

						{/* ── Source code (default) ───────────────────────── */}
						{effectiveMode === 'source' && (
							<pre
								className={cn(
									'p-3 border border-border border-t-0 overflow-x-auto overflow-y-auto font-mono text-sm max-h-[640px] bg-card line-numbers',
									wrap && '!whitespace-pre-wrap break-all',
								)}
							>
								<code ref={codeRef} className={`language-${activeLanguage}`}>
									{activeContent}
								</code>
							</pre>
						)}
					</div>
				);
			})()}

			{/* ── Password form ───────────────────────────────────── */}
			{paste.isEncrypted && !decrypted && showPasswordForm && !isDecrypting && (
				<div className="max-w-md mx-auto mt-3 border border-border bg-card">
					<div className="border-b border-border px-3 py-1.5 bg-card-alt">
						<span className="text-xs font-bold uppercase tracking-wide">Password required</span>
					</div>
					<form onSubmit={handlePasswordSubmit} className="px-3 py-3 space-y-2">
						<p className={cn(T.muted)}>Decryption happens locally in your browser.</p>
						<input
							type="password"
							value={passwordInput}
							onChange={(e) => setPasswordInput(e.target.value)}
							className="w-full h-7 border border-input bg-card px-2 text-xs font-mono"
							placeholder="Enter password"
							autoComplete="current-password"
							autoFocus
							required
						/>
						<div className="flex gap-2">
							<Button type="submit" variant="primary" disabled={!passwordInput.trim()}>
								Decrypt
							</Button>
							<Button type="button" variant="ghost" onClick={() => setShowPasswordForm(false)}>
								Cancel
							</Button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
}
