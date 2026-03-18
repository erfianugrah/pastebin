import { useState, useEffect } from 'react';
import { CheckCircle2, ChevronDown, Copy, Lock, Key, Shield, Info, Plus, X } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { toast } from './ui/toast';
import { Tooltip } from './ui/tooltip';
import { PasswordStrengthMeter } from './ui/password-strength';
import { generateEncryptionKey, encryptData, deriveKeyFromPassword } from '../lib/crypto';
import { validatePasteForm } from '../lib/validation';
import { detectLanguage } from '../lib/language-detect';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { cn } from '../lib/utils';
import { T } from '../lib/typography';

const isDev = typeof window !== 'undefined' && window.location?.hostname === 'localhost';

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

// ── Component ────────────────────────────────────────────────────────

export default function PasteForm() {
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [formErrors, setFormErrors] = useState<Record<string, string>>({});
	const [result, setResult] = useState<{ id: string; url: string; encryptionKey?: string } | null>(null);

	// Form state
	const [content, setContent] = useState('');
	const [isE2EEncrypted, setIsE2EEncrypted] = useState(false);
	const [passwordValue, setPasswordValue] = useState('');
	const [securityMethod, setSecurityMethod] = useState<'none' | 'password' | 'key'>('none');
	const [encryptionProgress, setEncryptionProgress] = useState<number | null>(null);
	const [language, setLanguage] = useState('');
	const [autoDetect, setAutoDetect] = useState(true);
	const [expiration, setExpiration] = useState('86400');
	const [visibility, setVisibility] = useState('public');
	const [viewLimitEnabled, setViewLimitEnabled] = useState(false);
	const [slug, setSlug] = useState('');
	const [showOptions, setShowOptions] = useState(false);
	const [files, setFiles] = useState<FileTab[]>([]);
	const [activeFileId, setActiveFileId] = useState<string | null>(null);
	const isMultiFile = files.length > 0;

	const { handleError } = useErrorHandler();

	// Edit mode state
	const [editMode, setEditMode] = useState<{ pasteId: string; token: string } | null>(null);

	// Load forked or edited paste content from sessionStorage
	useEffect(() => {
		try {
			// Check for edit mode first
			const edit = sessionStorage.getItem('pasteriser_edit');
			if (edit) {
				sessionStorage.removeItem('pasteriser_edit');
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

			// Check for fork
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

	// ── Clipboard helper ───────────────────────────────────────────────

	async function copyToClipboard(text: string, label: string) {
		if (!navigator?.clipboard) return;
		try {
			await navigator.clipboard.writeText(text);
			toast({ message: `${label} copied!`, type: 'success', duration: 2000 });
		} catch {
			toast({ message: `Failed to copy ${label.toLowerCase()}`, type: 'error', duration: 3000 });
		}
	}

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
			// Multi-file: serialize files array as JSON content
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
			let encryptionKey: string | undefined;
			const needsEncryption = e2eEncryption || (vis === 'private' && isE2EEncrypted) || !!password;

			// ── Encrypt ──────────────────────────────────────────────────
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
					} else {
						encryptionKey = generateEncryptionKey();
						encryptedContent = await encryptData(rawContent, encryptionKey, false, undefined, (p) => {
							setEncryptionProgress(p.percent);
						});
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

			const response = await fetch(fetchUrl, {
				method: fetchMethod,
				headers: { 'Content-Type': 'application/json' },
				body: isEdit
					? JSON.stringify({ token: editMode.token, content: encryptedContent, title, language: lang })
					: JSON.stringify({
						title,
						content: encryptedContent,
						language: lang,
						expiration: exp,
						visibility: vis,
						burnAfterReading,
						isEncrypted: needsEncryption,
						viewLimit,
						version: needsEncryption ? 2 : 0,
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

			// Handle edit success — redirect back to paste
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

			// Save delete/edit token for this paste
			if (data.deleteToken) {
				try { localStorage.setItem(`paste_token_${data.id}`, data.deleteToken); } catch { /* ignore */ }
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
			<Card className="max-w-2xl mx-auto">
				<CardContent className="pt-6 space-y-4">
					<div className="flex items-center gap-2 text-green-600 dark:text-green-400">
						<CheckCircle2 className="h-5 w-5" />
						<span className="font-medium">Paste created</span>
					</div>

					{/* URL */}
					<div className="flex items-center gap-2 bg-muted rounded-lg p-3">
						<a href={result.url} className="flex-1 font-mono text-sm text-primary truncate hover:underline" target="_blank" rel="noopener noreferrer">
							{result.url}
						</a>
						<Button variant="ghost" size="icon" className="shrink-0" onClick={() => copyToClipboard(result.url, 'URL')}>
							<Copy className="h-4 w-4" />
						</Button>
					</div>

					{/* Encryption key notice */}
					{result.encryptionKey && (
						<div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
							<div className="flex items-start gap-2">
								<Key className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
								<div className="text-sm">
									<p className="font-medium text-amber-800 dark:text-amber-200">End-to-end encrypted</p>
									<p className="text-amber-700 dark:text-amber-300 mt-1">
										The decryption key is in the URL after&nbsp;#. Share the complete URL to allow decryption.
									</p>
								</div>
							</div>
							<div className="flex items-center gap-2 bg-amber-100/50 dark:bg-amber-900/30 rounded-md p-2">
								<code className="flex-1 text-xs text-amber-800 dark:text-amber-300 truncate">{result.encryptionKey}</code>
								<Button variant="ghost" size="icon" className="shrink-0 h-7 w-7" onClick={() => copyToClipboard(result.encryptionKey!, 'Key')}>
									<Copy className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					)}

					<Button onClick={() => { setResult(null); setContent(''); }} variant="outline" className="w-full">
						Create another paste
					</Button>
				</CardContent>
			</Card>
		);
	}

	// ── Form ─────────────────────────────────────────────────────────

	const contentLength = new TextEncoder().encode(content).length;

	return (
		<Card className="max-w-2xl mx-auto">
			<CardContent className="pt-6">
				<form onSubmit={handleSubmit} className="space-y-4">
					{/* ── Content area ─────────────────────────────────── */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className={T.formLabel}>
								Content <span className="text-destructive">*</span>
							</label>
							<div className="flex items-center gap-2">
								{!isMultiFile && contentLength > 0 && (
									<span className={cn('text-xs', contentLength > MAX_CONTENT_BYTES * 0.9 ? 'text-destructive' : 'text-muted-foreground')}>
										{formatBytes(contentLength)}
									</span>
								)}
								<button
									type="button"
									onClick={() => {
										if (isMultiFile) {
											// Switch back to single file — take first file's content
											const first = files[0];
											if (first) { setContent(first.content); setLanguage(first.language); }
											setFiles([]);
											setActiveFileId(null);
										} else {
											// Switch to multi-file — move current content to first file
											const f = newFileTab('file1', content, language);
											setFiles([f]);
											setActiveFileId(f.id);
										}
									}}
									className="text-xs text-muted-foreground hover:text-foreground transition-colors"
								>
									{isMultiFile ? 'Single file' : '+ Multi-file'}
								</button>
							</div>
						</div>

						{isMultiFile ? (
							<>
								{/* File tabs */}
								<div className="flex items-center gap-1 mb-2 overflow-x-auto">
									{files.map((f) => (
										<button
											key={f.id}
											type="button"
											onClick={() => setActiveFileId(f.id)}
											className={cn(
												'flex items-center gap-1 px-2.5 py-1 text-xs rounded-t-md border border-b-0 transition-colors whitespace-nowrap',
												activeFileId === f.id
													? 'bg-background border-border text-foreground'
													: 'bg-muted/50 border-transparent text-muted-foreground hover:text-foreground',
											)}
										>
											<input
												type="text"
												value={f.name}
												onChange={(e) => setFiles(files.map(x => x.id === f.id ? { ...x, name: e.target.value } : x))}
												onClick={(e) => e.stopPropagation()}
												className="bg-transparent border-none outline-none w-20 text-xs"
												placeholder="filename"
											/>
											{files.length > 1 && (
												<X
													className="h-3 w-3 opacity-50 hover:opacity-100 cursor-pointer"
													onClick={(e) => {
														e.stopPropagation();
														const remaining = files.filter(x => x.id !== f.id);
														setFiles(remaining);
														if (activeFileId === f.id) setActiveFileId(remaining[0]?.id ?? null);
													}}
												/>
											)}
										</button>
									))}
									<button
										type="button"
										onClick={() => {
											const f = newFileTab(`file${files.length + 1}`);
											setFiles([...files, f]);
											setActiveFileId(f.id);
										}}
										className="p-1 text-muted-foreground hover:text-foreground transition-colors"
									>
										<Plus className="h-3.5 w-3.5" />
									</button>
								</div>
								{/* Active file editor */}
								{files.map((f) => f.id === activeFileId && (
									<Textarea
										key={f.id}
										placeholder="File content..."
										rows={12}
										value={f.content}
										onChange={(e) => setFiles(files.map(x => x.id === f.id ? { ...x, content: e.target.value } : x))}
										onKeyDown={(e) => {
											if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
												e.preventDefault();
												(e.target as HTMLTextAreaElement).form?.requestSubmit();
											}
										}}
										className="font-mono text-sm bg-background"
									/>
								))}
								{/* Hidden input for form validation */}
								<input type="hidden" name="content" value={files.some(f => f.content.trim()) ? 'multi' : ''} required />
							</>
						) : (
							<>
								<Textarea
									id="content"
									name="content"
									placeholder="Paste your code or text here... (Ctrl+Enter to submit)"
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
									className={cn('font-mono text-sm bg-background', formErrors.content && 'border-destructive')}
								/>
								{formErrors.content && <p id="content-error" role="alert" className={T.formError}>{formErrors.content}</p>}
							</>
						)}
					</div>

					{/* ── Title ────────────────────────────────────────── */}
					<div>
						<label htmlFor="title" className={T.formLabel}>Title</label>
						<input
							id="title"
							name="title"
							type="text"
							placeholder="Untitled"
							aria-invalid={!!formErrors.title}
							className={cn('w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-inner', formErrors.title && 'border-destructive')}
						/>
						{formErrors.title && <p role="alert" className={T.formError}>{formErrors.title}</p>}
					</div>

					{/* ── Language + Expiration ────────────────────────── */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<div className="flex items-center justify-between">
								<label className="text-sm font-medium">Language</label>
								<label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
									<input
										type="checkbox"
										checked={autoDetect}
										onChange={(e) => setAutoDetect(e.target.checked)}
										className="h-3 w-3 rounded border-input form-checkbox"
									/>
									Auto
								</label>
							</div>
							<Select value={language} onValueChange={(v) => { setLanguage(v); setAutoDetect(false); }}>
								<SelectTrigger className="w-full"><SelectValue placeholder="Plain Text" /></SelectTrigger>
								<SelectContent>
									<SelectItem value="plaintext">Plain Text</SelectItem>
									<SelectSeparator />
									<SelectGroup>
										<SelectLabel>Web</SelectLabel>
										<SelectItem value="markup">HTML</SelectItem>
										<SelectItem value="css">CSS</SelectItem>
										<SelectItem value="javascript">JavaScript</SelectItem>
										<SelectItem value="typescript">TypeScript</SelectItem>
										<SelectItem value="jsx">JSX</SelectItem>
										<SelectItem value="tsx">TSX</SelectItem>
										<SelectItem value="php">PHP</SelectItem>
									</SelectGroup>
									<SelectGroup>
										<SelectLabel>Data</SelectLabel>
										<SelectItem value="json">JSON</SelectItem>
										<SelectItem value="yaml">YAML</SelectItem>
										<SelectItem value="toml">TOML</SelectItem>
										<SelectItem value="xml-doc">XML</SelectItem>
										<SelectItem value="ini">INI</SelectItem>
										<SelectItem value="sql">SQL</SelectItem>
										<SelectItem value="graphql">GraphQL</SelectItem>
									</SelectGroup>
									<SelectGroup>
										<SelectLabel>Systems</SelectLabel>
										<SelectItem value="python">Python</SelectItem>
										<SelectItem value="go">Go</SelectItem>
										<SelectItem value="rust">Rust</SelectItem>
										<SelectItem value="java">Java</SelectItem>
										<SelectItem value="csharp">C#</SelectItem>
										<SelectItem value="c">C</SelectItem>
										<SelectItem value="cpp">C++</SelectItem>
										<SelectItem value="ruby">Ruby</SelectItem>
										<SelectItem value="kotlin">Kotlin</SelectItem>
										<SelectItem value="swift">Swift</SelectItem>
										<SelectItem value="scala">Scala</SelectItem>
										<SelectItem value="perl">Perl</SelectItem>
										<SelectItem value="r">R</SelectItem>
									</SelectGroup>
									<SelectGroup>
										<SelectLabel>DevOps</SelectLabel>
										<SelectItem value="bash">Bash</SelectItem>
										<SelectItem value="shell-session">Shell</SelectItem>
										<SelectItem value="powershell">PowerShell</SelectItem>
										<SelectItem value="docker">Dockerfile</SelectItem>
										<SelectItem value="hcl">HCL (Terraform)</SelectItem>
										<SelectItem value="nginx">Nginx</SelectItem>
									</SelectGroup>
									<SelectGroup>
										<SelectLabel>Markup &amp; Style</SelectLabel>
										<SelectItem value="markdown">Markdown</SelectItem>
										<SelectItem value="latex">LaTeX</SelectItem>
										<SelectItem value="scss">SCSS</SelectItem>
										<SelectItem value="less">LESS</SelectItem>
									</SelectGroup>
								</SelectContent>
							</Select>
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

					{/* ── Options toggle ───────────────────────────────── */}
					<button
						type="button"
						onClick={() => setShowOptions(!showOptions)}
						className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
					>
						<ChevronDown className={cn('h-4 w-4 transition-transform', showOptions && 'rotate-180')} />
						Security &amp; Privacy
					</button>

					{/* ── Collapsible options ──────────────────────────── */}
					{showOptions && (
						<div className="space-y-4 rounded-lg border border-border bg-card p-4">
							{/* Visibility + Security method */}
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className={T.formLabel}>Visibility</label>
									<Select value={visibility} onValueChange={setVisibility}>
										<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="public">Public</SelectItem>
											<SelectItem value="private">Private</SelectItem>
										</SelectContent>
									</Select>
									<input type="hidden" name="visibility" value={visibility} />
								</div>
								<div>
									<div className="flex items-center gap-1 mb-1">
										<label className="text-sm font-medium block">Encryption</label>
										<Tooltip content="None = plaintext. Password = PBKDF2 key derivation. Key = 256-bit random key in URL." position="top">
											<Info className="h-3.5 w-3.5 text-muted-foreground" />
										</Tooltip>
									</div>
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
											<SelectItem value="none">None</SelectItem>
											<SelectItem value="password">Password (E2EE)</SelectItem>
											<SelectItem value="key">Key (E2EE)</SelectItem>
										</SelectContent>
									</Select>
									<input type="hidden" name="securityMethod" value={!isE2EEncrypted ? 'none' : securityMethod} />
								</div>
							</div>

							{/* Password field */}
							{isE2EEncrypted && (
								<div>
									<label htmlFor="password" className={T.formLabel}>
										{securityMethod === 'password' ? 'Encryption password' : 'Password (leave empty for key mode)'}
									</label>
									<input
										type="password"
										id="password"
										name="password"
										autoComplete="new-password"
										placeholder={securityMethod === 'password' ? 'Enter a strong password' : 'Leave empty for key-based encryption'}
										className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-inner"
										value={passwordValue}
										onChange={(e) => {
											setPasswordValue(e.target.value);
											if (e.target.value.trim()) setSecurityMethod('password');
										}}
									/>
									{passwordValue && <PasswordStrengthMeter password={passwordValue} />}
								</div>
							)}

							{/* Burn + View limit */}
							<div className="space-y-3 pt-2 border-t border-border">
								<label className="flex items-center gap-2.5 cursor-pointer">
									<input type="checkbox" name="burnAfterReading" className="h-4 w-4 rounded border-input form-checkbox" />
									<div>
										<span className="text-sm font-medium">Burn after reading</span>
										<p className="text-xs text-muted-foreground">Deleted after first view</p>
									</div>
								</label>

								<label className="flex items-center gap-2.5 cursor-pointer">
									<input
										type="checkbox"
										checked={viewLimitEnabled}
										onChange={(e) => setViewLimitEnabled(e.target.checked)}
										className="h-4 w-4 rounded border-input form-checkbox"
									/>
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium">Limit views</span>
										<input
											type="number"
											name="viewLimit"
											min="1"
											max="100"
											defaultValue="1"
											disabled={!viewLimitEnabled}
											className="w-14 px-2 py-0.5 text-xs rounded border border-input bg-background"
										/>
									</div>
								</label>
							</div>

							{/* Vanity URL */}
							<div className="pt-2 border-t border-border">
								<label htmlFor="slug" className={T.formLabel}>Custom URL (optional)</label>
								<div className="flex items-center gap-2">
									<span className="text-xs text-muted-foreground whitespace-nowrap">paste.erfi.dev/p/</span>
									<input
										id="slug"
										type="text"
										value={slug}
										onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
										placeholder="my-snippet"
										maxLength={64}
										className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-inner"
									/>
								</div>
								{slug && slug.length < 3 && (
									<p className="text-xs text-destructive mt-1">Minimum 3 characters</p>
								)}
							</div>

							{/* Encryption status */}
							{isE2EEncrypted && (
								<div className="flex items-start gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3">
									<Shield className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" />
									<p className="text-xs text-blue-700 dark:text-blue-300">
										Content will be encrypted in your browser before upload. The server never sees the original content.
									</p>
								</div>
							)}
						</div>
					)}

					{/* Hidden fields */}
					<input type="hidden" name="e2eEncryption" value={isE2EEncrypted ? 'on' : 'off'} readOnly />
					<input type="hidden" name="viewLimitEnabled" value={viewLimitEnabled ? 'true' : 'false'} readOnly />
					<input type="hidden" name="enableViewLimit" value={viewLimitEnabled ? 'on' : 'off'} readOnly />

					{/* ── Progress bar ─────────────────────────────────── */}
					{isSubmitting && encryptionProgress !== null && (
						<div>
							<div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
								<span>Encrypting...</span>
								<span>{encryptionProgress}%</span>
							</div>
							<div className="w-full bg-muted rounded-full h-1.5" role="progressbar" aria-valuenow={encryptionProgress} aria-valuemin={0} aria-valuemax={100}>
								<div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${encryptionProgress}%` }} />
							</div>
						</div>
					)}

					{/* ── Actions ──────────────────────────────────────── */}
					<CardFooter className="flex justify-between p-0 pt-2">
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting
								? encryptionProgress !== null ? `Encrypting (${encryptionProgress}%)` : (editMode ? 'Saving...' : 'Creating...')
								: editMode ? 'Save Changes' : 'Create Paste'}
						</Button>
						<Button
							type="reset"
							variant="ghost"
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
								setShowOptions(false);
								setContent('');
							}}
						>
							Clear
						</Button>
					</CardFooter>
				</form>
			</CardContent>
		</Card>
	);
}
