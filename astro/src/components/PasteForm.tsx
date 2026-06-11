import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { LanguageCombobox } from './ui/language-combobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { toast } from './ui/toast';
import { PasswordStrengthMeter } from './ui/password-strength';
import { generateEncryptionKey, encryptData, deriveKeyFromPassword } from '../lib/crypto';
import { savePasteToken } from '../lib/pasteTokenStorage';
import { validatePasteForm } from '../lib/validation';
import { detectLanguage } from '../lib/language-detect';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { cn } from '../lib/utils';
import { T } from '../lib/typography';

// ── Types ────────────────────────────────────────────────────────────

interface FileTab {
	id: string;
	name: string;
	content: string;
	language: string;
}

function newFileTab(name = '', content = '', language = ''): FileTab {
	return { id: crypto.randomUUID(), name, content, language };
}

// ── Helpers ──────────────────────────────────────────────────────────

const MAX_CONTENT_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function copyToClipboard(text: string, label: string) {
	if (!navigator?.clipboard) return;
	try {
		await navigator.clipboard.writeText(text);
		toast({ message: `${label} copied!`, type: 'success', duration: 2000 });
	} catch {
		toast({ message: `Failed to copy ${label.toLowerCase()}`, type: 'error', duration: 3000 });
	}
}

// ── Component ────────────────────────────────────────────────────────

export default function PasteForm() {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [formErrors, setFormErrors] = useState<Record<string, string>>({});
	const [result, setResult] = useState<{ id: string; url: string; encryptionKey?: string } | null>(null);

	// Form state
	const [content, setContent] = useState('');
	// Privacy-by-default: new pastes are E2E-encrypted with a random key in the
	// URL fragment unless the user explicitly switches Encryption to "None".
	// Edit mode overrides this to 'none' (see the edit-load effect) because the
	// PUT/update path does not touch version/is_encrypted, so re-encrypting an
	// existing plaintext paste would store ciphertext the viewer never decrypts.
	const [isE2EEncrypted, setIsE2EEncrypted] = useState(true);
	const [passwordValue, setPasswordValue] = useState('');
	const [securityMethod, setSecurityMethod] = useState<'none' | 'password' | 'key'>('key');
	const [encryptionProgress, setEncryptionProgress] = useState<number | null>(null);
	const [language, setLanguage] = useState('');
	const [autoDetect, setAutoDetect] = useState(true);
	const [expiration, setExpiration] = useState('86400');
	const [visibility, setVisibility] = useState('public');
	const [viewLimitEnabled, setViewLimitEnabled] = useState(false);
	const [slug, setSlug] = useState('');
	const [files, setFiles] = useState<FileTab[]>([]);
	const [activeFileId, setActiveFileId] = useState<string | null>(null);
	const isMultiFile = files.length > 0;

	const { handleError } = useErrorHandler();

	// Edit mode state
	const [editMode, setEditMode] = useState<{ pasteId: string; token: string } | null>(null);

	// Load forked or edited paste content from sessionStorage
	useEffect(() => {
		try {
			const edit = sessionStorage.getItem('pasteriser_edit');
			if (edit) {
				sessionStorage.removeItem('pasteriser_edit');
				// Editing an existing paste: do not force-encrypt. The update path
				// leaves version/is_encrypted untouched, so default-on would corrupt
				// a plaintext paste. The user can still opt back into encryption.
				setIsE2EEncrypted(false);
				setSecurityMethod('none');
				const data = JSON.parse(edit) as { pasteId: string; content?: string; title?: string; language?: string; token?: string };
				if (data.content) setContent(data.content);
				if (data.title) {
					setTimeout(() => {
						const titleInput = document.getElementById('title') as HTMLInputElement;
						if (titleInput) titleInput.value = data.title!;
					}, 0);
				}
				if (data.language) setLanguage(data.language);
				if (data.pasteId && data.token) setEditMode({ pasteId: data.pasteId, token: data.token });
				return;
			}

			const fork = sessionStorage.getItem('pasteriser_fork');
			if (fork) {
				sessionStorage.removeItem('pasteriser_fork');
				const data = JSON.parse(fork) as { content?: string; title?: string; language?: string };
				if (data.content) setContent(data.content);
				if (data.title) {
					setTimeout(() => {
						const titleInput = document.getElementById('title') as HTMLInputElement;
						if (titleInput) titleInput.value = data.title!;
					}, 0);
				}
				if (data.language) setLanguage(data.language);
			}
		} catch { /* ignore */ }
	}, []);

	// Auto-detect language when content changes (debounced)
	useEffect(() => {
		if (!autoDetect || !content || content.length < 20) return;
		const timer = setTimeout(() => {
			const detected = detectLanguage(content);
			if (detected && detected !== language) {
				setLanguage(detected);
			}
		}, 500);
		return () => clearTimeout(timer);
	}, [content, autoDetect]);

	// Sync security method with encryption state
	useEffect(() => {
		if (isE2EEncrypted && securityMethod === 'none') {
			setSecurityMethod(passwordValue ? 'password' : 'key');
		} else if (!isE2EEncrypted && securityMethod !== 'none') {
			setSecurityMethod('none');
		}
	}, [isE2EEncrypted, passwordValue]);

	// ── Submit ─────────────────────────────────────────────────────────

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		setIsSubmitting(true);
		setFormErrors({});
		setEncryptionProgress(null);

		try {
			const form = e.target as HTMLFormElement;
			const formData = new FormData(form);

			// Validate
			const formFields: Record<string, string> = {};
			formData.forEach((value, key) => { formFields[key] = value.toString(); });
			const validationErrors = validatePasteForm(formFields);
			if (Object.keys(validationErrors).length > 0) {
				const errors: Record<string, string> = {};
				for (const [field, error] of Object.entries(validationErrors)) errors[field] = error.message;
				setFormErrors(errors);
				setIsSubmitting(false);
				return;
			}

			const title = formData.get('title') as string;
			const rawContent = isMultiFile
				? JSON.stringify(files.map(f => ({ name: f.name || 'untitled', content: f.content, language: f.language })))
				: formData.get('content') as string;
			const lang = isMultiFile ? '_multi' : formData.get('language') as string;
			const exp = parseInt(formData.get('expiration') as string, 10);
			const vis = formData.get('visibility') as string;
			const password = formData.get('password') as string;
			const burnAfterReading = formData.get('burnAfterReading') === 'on';
			const e2eEncryption = formData.get('e2eEncryption') === 'on';
			const viewLimit = viewLimitEnabled ? parseInt(formData.get('viewLimit') as string, 10) : undefined;

			let encryptedContent = rawContent;
			let encryptedTitle: string | undefined;
			let encryptionKey: string | undefined;
			const needsEncryption = e2eEncryption || (vis === 'private' && isE2EEncrypted) || !!password;

			// ── Encrypt ──────────────────────────────────────────────────
			// version 3 = content AND title encrypted (title is metadata that
			// would otherwise leak via the DB / public listing). The title is
			// encrypted under the same key/salt as the content, as an independent
			// blob (own nonce). Empty titles are left as-is.
			if (needsEncryption) {
				try {
					setEncryptionProgress(0);
					if (password) {
						const { key: derivedKey, salt } = await deriveKeyFromPassword(password, undefined, (p) => {
							setEncryptionProgress(Math.floor(p.percent * 0.3));
						});
						encryptedContent = await encryptData(rawContent, derivedKey, true, salt, (p) => {
							setEncryptionProgress(30 + Math.floor(p.percent * 0.7));
						});
						if (title) encryptedTitle = await encryptData(title, derivedKey, true, salt);
					} else {
						encryptionKey = generateEncryptionKey();
						encryptedContent = await encryptData(rawContent, encryptionKey, false, undefined, (p) => {
							setEncryptionProgress(p.percent);
						});
						if (title) encryptedTitle = await encryptData(title, encryptionKey, false);
					}
					setEncryptionProgress(100);
				} catch (error) {
					const err = new Error('Failed to encrypt content. Please try again.');
					(err as any).originalError = error;
					(err as any).code = 'encryption_failed';
					throw err;
				}
			}

			// ── Create or update paste ───────────────────────────────────
			const isEdit = !!editMode;
			const fetchUrl = isEdit ? `/pastes/${editMode.pasteId}` : '/pastes';
			const fetchMethod = isEdit ? 'PUT' : 'POST';

			const headers: Record<string, string> = { 'Content-Type': 'application/json' };

			const response = await fetch(fetchUrl, {
				method: fetchMethod,
				credentials: 'same-origin',
				headers,
				body: isEdit
					? JSON.stringify({ token: editMode.token, content: encryptedContent, title: encryptedTitle ?? title, language: lang })
					: JSON.stringify({
						title: encryptedTitle ?? title,
						content: encryptedContent,
						language: lang,
						expiration: exp,
						visibility: vis,
						burnAfterReading,
						isEncrypted: needsEncryption,
						viewLimit,
						version: needsEncryption ? 3 : 0,
						...(slug.trim() ? { slug: slug.trim().toLowerCase() } : {}),
					}),
			}).catch((fetchError) => {
				const err = new Error('Network error. Please check your connection and try again.');
				(err as any).originalError = fetchError;
				(err as any).code = 'network_error';
				throw err;
			});

			if (!response.ok) {
				const errorData = (await response.json()) as { error?: { message?: string; code?: string } };
				const err = new Error(errorData.error?.message || 'Failed to create paste');
				(err as any).code = errorData.error?.code || 'server_error';
				throw err;
			}

			if (isEdit) {
				toast({ message: 'Paste updated!', type: 'success' });
				window.location.href = `/pastes/${editMode.pasteId}`;
				return;
			}

			const data = (await response.json()) as { id: string; url: string; deleteToken?: string };

			let resultUrl = data.url;
			if (needsEncryption && encryptionKey) {
				const encodedKey = encryptionKey.replace(/\+/g, '%2B').replace(/\//g, '%2F').replace(/=/g, '%3D');
				resultUrl = `${data.url}#key=${encodedKey}`;
			}

			if (data.deleteToken) {
				await savePasteToken(data.id, data.deleteToken);
			}

			setResult({
				id: data.id,
				url: resultUrl,
				...(encryptionKey ? { encryptionKey } : {}),
			});
			toast({ message: 'Paste created!', type: 'success' });
		} catch (error) {
			handleError(error, { location: 'PasteForm.handleSubmit' });
		} finally {
			setIsSubmitting(false);
		}
	}

	// ── Result screen ────────────────────────────────────────────────

	if (result) {
		return (
			<div className="animate-fade-in">
				<div className="border border-success bg-card">
					<div className="border-b border-success px-4 py-2 bg-card-alt">
						<h2 className="text-sm font-bold uppercase tracking-wide text-success">
							✓ Paste created
						</h2>
					</div>
					<div className="px-4 py-3 space-y-3">
						<dl className="dl-inline">
							<dt>ID</dt>
							<dd className="font-mono">{result.id}</dd>
						</dl>

						<div>
							<div className="t-form-label">URL</div>
							<div className="flex items-stretch border border-border bg-card-alt">
								<a
									href={result.url}
									className="flex-1 px-2 py-1.5 font-mono text-xs truncate text-link no-underline hover:underline"
									target="_blank"
									rel="noopener noreferrer"
								>
									{result.url}
								</a>
								<button
									type="button"
									onClick={() => copyToClipboard(result.url, 'URL')}
									className="btn px-2 border-l border-border bg-primary text-primary-foreground hover:bg-primary-hover text-xs uppercase tracking-wide"
								>
									Copy
								</button>
							</div>
						</div>

						{result.encryptionKey && (
							<div className="border border-warning bg-card">
								<div className="border-b border-warning px-3 py-1.5 bg-card-alt">
									<span className="text-xs font-bold uppercase tracking-wide text-warning">
										⚠ End-to-end encrypted
									</span>
								</div>
								<div className="px-3 py-2 space-y-2">
									<p className="text-xs text-foreground">
										The decryption key is in the URL after <code className="text-foreground">#</code>. Share the complete URL or
										the key will be lost — the server cannot recover it.
									</p>
									<div className="flex items-stretch border border-border bg-card-alt">
										<code className="flex-1 px-2 py-1 font-mono text-xs truncate text-foreground">
											{result.encryptionKey}
										</code>
										<button
											type="button"
											onClick={() => copyToClipboard(result.encryptionKey!, 'Key')}
											className="btn px-2 border-l border-border text-xs uppercase tracking-wide hover:bg-muted"
										>
											Copy key
										</button>
									</div>
								</div>
							</div>
						)}
					</div>
					<div className="border-t border-success px-4 py-2.5 flex flex-wrap gap-2">
						<Button variant="primary" asChild>
							<a href={`/pastes/${result.id}`} className="no-underline">Open paste →</a>
						</Button>
						<Button
							onClick={() => {
								setResult(null);
								setContent('');
								setSlug('');
								setIsE2EEncrypted(false);
								setSecurityMethod('none');
								setPasswordValue('');
							}}
						>
							New paste
						</Button>
						<Button onClick={() => copyToClipboard(result.url, 'URL')}>
							Copy URL
						</Button>
					</div>
				</div>
			</div>
		);
	}

	// ── Form ─────────────────────────────────────────────────────────

	const contentLength = new TextEncoder().encode(content).length;

	return (
		<form onSubmit={handleSubmit} className="border border-border bg-card animate-fade-in">
			{/* Title bar */}
			<div className="border-b border-border-strong px-4 py-2 flex items-center justify-between bg-card-alt">
				<h1 className="text-sm font-bold uppercase tracking-wide">
					{editMode ? 'Edit paste' : 'New paste'}
				</h1>
				<div className="flex items-center gap-3 text-xs text-muted-foreground">
					{!isMultiFile && contentLength > 0 && (
						<span className={cn('font-mono', contentLength > MAX_CONTENT_BYTES * 0.9 && 'text-destructive')}>
							{formatBytes(contentLength)}
						</span>
					)}
					<button
						type="button"
						onClick={() => {
							if (isMultiFile) {
								const first = files[0];
								if (first) { setContent(first.content); setLanguage(first.language); }
								setFiles([]);
								setActiveFileId(null);
							} else {
								const f = newFileTab('file1', content, language);
								setFiles([f]);
								setActiveFileId(f.id);
							}
						}}
						className="nav-link uppercase tracking-wide hover:underline"
					>
						{isMultiFile ? '[single file]' : '[+ multi-file]'}
					</button>
				</div>
			</div>

			<div className="px-4 py-3 space-y-3">
				{/* ── Content area ─────────────────────────────────────── */}
				<div>
					{isMultiFile ? (
						<>
							<div className="flex items-stretch gap-px mb-px overflow-x-auto bg-border">
								{files.map((f) => (
									<div
										key={f.id}
										onClick={() => setActiveFileId(f.id)}
										className={cn(
											'flex items-center gap-1 px-2 py-1 text-xs cursor-pointer whitespace-nowrap',
											activeFileId === f.id ? 'bg-card text-foreground' : 'bg-card-alt text-muted-foreground hover:text-foreground',
										)}
									>
										<input
											type="text"
											value={f.name}
											onChange={(e) => setFiles(files.map(x => x.id === f.id ? { ...x, name: e.target.value } : x))}
											onClick={(e) => e.stopPropagation()}
											className="bg-transparent border-none outline-none w-24 text-xs font-mono"
											placeholder="filename"
										/>
										{files.length > 1 && (
											<X
												className="h-3 w-3 opacity-60 hover:opacity-100"
												onClick={(e) => {
													e.stopPropagation();
													const remaining = files.filter(x => x.id !== f.id);
													setFiles(remaining);
													if (activeFileId === f.id) setActiveFileId(remaining[0]?.id ?? null);
												}}
											/>
										)}
									</div>
								))}
								<button
									type="button"
									onClick={() => {
										const f = newFileTab(`file${files.length + 1}`);
										setFiles([...files, f]);
										setActiveFileId(f.id);
									}}
									className="px-2 py-1 bg-card-alt text-muted-foreground hover:text-foreground hover:bg-muted"
									title="Add file"
								>
									<Plus className="h-3.5 w-3.5" />
								</button>
							</div>
							{files.map((f) => f.id === activeFileId && (
								<Textarea
									key={f.id}
									placeholder="File content…"
									rows={14}
									value={f.content}
									onChange={(e) => setFiles(files.map(x => x.id === f.id ? { ...x, content: e.target.value } : x))}
									onKeyDown={(e) => {
										if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
											e.preventDefault();
											(e.target as HTMLTextAreaElement).form?.requestSubmit();
										}
									}}
									className="font-mono"
								/>
							))}
							<input type="hidden" name="content" value={files.some(f => f.content.trim()) ? 'multi' : ''} required />
						</>
					) : (
						<>
							<Textarea
								id="content"
								name="content"
								placeholder="Paste your code or text here… (Ctrl+Enter to submit)"
								rows={14}
								required
								value={content}
								onChange={(e) => setContent(e.target.value)}
								onKeyDown={(e) => {
									if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
										e.preventDefault();
										(e.target as HTMLTextAreaElement).form?.requestSubmit();
									}
								}}
								aria-invalid={!!formErrors.content}
								aria-describedby={formErrors.content ? 'content-error' : undefined}
								className={cn('font-mono', formErrors.content && 'border-destructive')}
							/>
							{formErrors.content && <p id="content-error" role="alert" className={T.formError}>{formErrors.content}</p>}
						</>
					)}
				</div>

				{/* ── Title + Language + Expiration ─────────────────── */}
				<div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-3">
					<div>
						<label htmlFor="title" className={T.formLabel}>Title</label>
						<input
							id="title"
							name="title"
							type="text"
							placeholder="Untitled"
							aria-invalid={!!formErrors.title}
							className={cn('h-7 w-full border border-input bg-card px-2 text-xs', formErrors.title && 'border-destructive')}
						/>
						{formErrors.title && <p role="alert" className={T.formError}>{formErrors.title}</p>}
					</div>

					<div>
						<div className="flex items-center justify-between">
							<label className={T.formLabel}>Language</label>
							<label className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground cursor-pointer mb-1">
								<Checkbox
									checked={autoDetect}
									onChange={(e) => setAutoDetect(e.target.checked)}
								/>
								Auto
							</label>
						</div>
						<LanguageCombobox
							value={language}
							onChange={(v) => { setLanguage(v); setAutoDetect(false); }}
						/>
						<input type="hidden" name="language" value={language} />
					</div>

					<div>
						<label className={T.formLabel}>Expiration</label>
						<Select value={expiration} onValueChange={setExpiration}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="3600">1 hour</SelectItem>
								<SelectItem value="86400">1 day</SelectItem>
								<SelectItem value="604800">1 week</SelectItem>
								<SelectItem value="2592000">30 days</SelectItem>
								<SelectItem value="31536000">1 year</SelectItem>
							</SelectContent>
						</Select>
						<input type="hidden" name="expiration" value={expiration} />
					</div>
				</div>

				{/* ── Visibility + Encryption (always visible) ─────── */}
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<div>
						<label className={T.formLabel}>Visibility</label>
						<Select value={visibility} onValueChange={setVisibility}>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="public">Public — listed</SelectItem>
								<SelectItem value="private">Private — link only</SelectItem>
							</SelectContent>
						</Select>
						<input type="hidden" name="visibility" value={visibility} />
					</div>

					<div>
						<label className={T.formLabel}>Encryption</label>
						<Select
							value={!isE2EEncrypted ? 'none' : securityMethod === 'none' ? (passwordValue ? 'password' : 'key') : securityMethod}
							onValueChange={(v: string) => {
								const method = v as 'none' | 'password' | 'key';
								setSecurityMethod(method);
								if (method === 'none') { setIsE2EEncrypted(false); setPasswordValue(''); }
								else { setIsE2EEncrypted(true); if (method === 'key') setPasswordValue(''); }
							}}
						>
							<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
							<SelectContent>
								<SelectItem value="none">None — plaintext</SelectItem>
								<SelectItem value="key">E2EE — random key in URL</SelectItem>
								<SelectItem value="password">E2EE — password (PBKDF2)</SelectItem>
							</SelectContent>
						</Select>
						<input type="hidden" name="securityMethod" value={!isE2EEncrypted ? 'none' : securityMethod} />
					</div>
				</div>

				{/* ── Password field (inline when applicable) ──────── */}
				{isE2EEncrypted && securityMethod === 'password' && (
					<div>
						<label htmlFor="password" className={T.formLabel}>Encryption password</label>
						<input
							type="password"
							id="password"
							name="password"
							autoComplete="new-password"
							placeholder="Enter a strong password"
							className="h-7 w-full border border-input bg-card px-2 text-xs font-mono"
							value={passwordValue}
							onChange={(e) => setPasswordValue(e.target.value)}
						/>
						{passwordValue && <PasswordStrengthMeter password={passwordValue} />}
					</div>
				)}

				{/* ── Burn / view-limit / vanity (always visible) ──── */}
				<div className="border-t border-border pt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
					<label className="flex items-start gap-2 cursor-pointer">
						<Checkbox name="burnAfterReading" className="mt-0.5" />
						<span>
							<span className="text-xs font-semibold uppercase tracking-wide">Burn after reading</span>
							<span className="block text-[11px] text-muted-foreground">Deleted after first view</span>
						</span>
					</label>

					<label className="flex items-start gap-2 cursor-pointer">
						<Checkbox
							checked={viewLimitEnabled}
							onChange={(e) => setViewLimitEnabled(e.target.checked)}
							className="mt-0.5"
						/>
						<span className="flex-1">
							<span className="flex items-center gap-2">
								<span className="text-xs font-semibold uppercase tracking-wide">Limit views</span>
								<input
									type="number"
									name="viewLimit"
									min="1"
									max="100"
									defaultValue="1"
									disabled={!viewLimitEnabled}
									className="w-14 h-5 px-1 text-xs border border-input bg-card font-mono"
								/>
							</span>
							<span className="block text-[11px] text-muted-foreground">Delete after N reads</span>
						</span>
					</label>
				</div>

				{/* ── Vanity URL ────────────────────────────────────── */}
				<div>
					<label htmlFor="slug" className={T.formLabel}>Custom URL (optional)</label>
					<div className="flex items-stretch border border-input bg-card">
						<span className="px-2 py-1.5 text-xs text-muted-foreground bg-card-alt border-r border-input whitespace-nowrap font-mono">
							{typeof window !== 'undefined' ? new URL('/p/', window.location.origin).host + '/p/' : '/p/'}
						</span>
						<input
							id="slug"
							type="text"
							value={slug}
							onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
							placeholder="my-snippet"
							maxLength={64}
							className="flex-1 px-2 text-xs font-mono outline-none bg-card border-0"
						/>
					</div>
					{slug && slug.length < 3 && (
						<p className="text-xs text-destructive mt-1">Minimum 3 characters</p>
					)}
				</div>

				{/* Hidden fields */}
				<input type="hidden" name="e2eEncryption" value={isE2EEncrypted ? 'on' : 'off'} readOnly />
				<input type="hidden" name="viewLimitEnabled" value={viewLimitEnabled ? 'true' : 'false'} readOnly />
				<input type="hidden" name="enableViewLimit" value={viewLimitEnabled ? 'on' : 'off'} readOnly />

				{/* ── Encryption notice ──────────────────────────────── */}
				{isE2EEncrypted && (
					<div className="notice notice-info">
						<span>
							<span className="text-xs font-semibold uppercase tracking-wide">Client-side encryption.</span>{' '}
							<span className="text-xs">
								Content is encrypted in your browser before upload. The server never sees the plaintext.
								{securityMethod === 'key' && ' The key is appended to the URL after #.'}
							</span>
						</span>
					</div>
				)}

				{/* ── Progress bar ─────────────────────────────────── */}
				{isSubmitting && encryptionProgress !== null && (
					<div>
						<div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
							<span>Encrypting…</span>
							<span className="font-mono">{encryptionProgress}%</span>
						</div>
						<div className="w-full bg-muted h-1" role="progressbar" aria-valuenow={encryptionProgress} aria-valuemin={0} aria-valuemax={100}>
							<div className="bg-primary h-1" style={{ width: `${encryptionProgress}%` }} />
						</div>
					</div>
				)}
			</div>

			{/* ── Actions ──────────────────────────────────────────── */}
			<div className="border-t border-border-strong bg-card-alt px-4 py-2.5 flex items-center justify-between gap-2">
				<Button type="submit" variant="primary" size="lg" disabled={isSubmitting}>
					{isSubmitting
						? encryptionProgress !== null
							? `Encrypting ${encryptionProgress}%`
							: editMode ? 'Saving…' : 'Creating…'
						: editMode ? 'Save changes' : 'Create paste'}
				</Button>
				<button
					type="reset"
					disabled={isSubmitting}
					onClick={() => {
						setFormErrors({});
						setIsE2EEncrypted(false);
						setSecurityMethod('none');
						setPasswordValue('');
						setLanguage('');
						setExpiration('86400');
						setVisibility('public');
						setViewLimitEnabled(false);
						setSlug('');
						setContent('');
					}}
					className="text-xs uppercase tracking-wide text-muted-foreground hover:underline"
				>
					Clear
				</button>
			</div>
		</form>
	);
}
