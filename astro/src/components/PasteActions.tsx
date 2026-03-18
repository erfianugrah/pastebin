import { useState, useEffect } from 'react';
import { Plus, FileText, Trash2, Copy, Download, GitFork, QrCode, Code2, Pencil } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from './ui/toast';
import { showConfirmModal } from './ui/modal';
import { cn } from '../lib/utils';

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

	// Check if user has a saved token for this paste (means they created it)
	useEffect(() => {
		try {
			const token = localStorage.getItem(`paste_token_${pasteId}`);
			setHasEditToken(!!token);
		} catch { /* ignore */ }
	}, [pasteId]);

	const getContent = () => {
		const text = isEncrypted ? getDecryptedContent() : getRawContent();
		if (!text && isEncrypted) {
			toast({ message: 'Still decrypting...', type: 'info', duration: 2000 });
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

	const handleEdit = () => {
		const text = getContent();
		if (!text) return;
		sessionStorage.setItem('pasteriser_edit', JSON.stringify({
			pasteId,
			content: text,
			title: pasteTitle,
			language: pasteLanguage,
			token: localStorage.getItem(`paste_token_${pasteId}`),
		}));
		window.location.href = '/';
	};

	const handleDelete = async () => {
		const confirmed = await showConfirmModal({
			title: 'Delete Paste',
			description: 'Are you sure? This action cannot be undone.',
			confirmText: 'Delete',
			cancelText: 'Cancel',
			isDangerous: true,
		});
		if (confirmed) {
			// Pass the delete token via sessionStorage so the delete page can use it
			try {
				const token = localStorage.getItem(`paste_token_${pasteId}`);
				if (token) sessionStorage.setItem('pasteriser_delete_token', token);
			} catch { /* ignore */ }
			window.location.href = `/pastes/${pasteId}/delete`;
		}
	};

	const pasteUrl = typeof window !== 'undefined' ? window.location.href : '';
	const rawUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/pastes/raw/${pasteId}`;

	const embedSnippet = `<iframe src="${rawUrl}" style="width:100%;height:400px;border:1px solid #ccc;border-radius:4px;" sandbox="allow-same-origin"></iframe>`;
	const scriptSnippet = `<script src="${rawUrl}" defer><\/script>`;

	return (
		<>
			{/* ── Action buttons — icon-only on mobile, icon+label on desktop ── */}
			<div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-1.5 sm:gap-2">
				<Button variant="outline" size="sm" asChild>
					<a href="/"><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">New</span></a>
				</Button>
				{hasEditToken && (
					<Button variant="outline" size="sm" onClick={handleEdit}>
						<Pencil className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Edit</span>
					</Button>
				)}
				<Button variant="outline" size="sm" onClick={handleFork}>
					<GitFork className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Fork</span>
				</Button>
				<Button variant="outline" size="sm" onClick={handleViewRaw}>
					<FileText className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Raw</span>
				</Button>
				<Button variant="outline" size="sm" onClick={handleCopy}>
					<Copy className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Copy</span>
				</Button>
				<Button variant="outline" size="sm" onClick={handleDownload}>
					<Download className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Download</span>
				</Button>
				<Button variant="outline" size="sm" onClick={() => setShowPanel(showPanel === 'qr' ? 'none' : 'qr')}>
					<QrCode className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">QR</span>
				</Button>
				{!isEncrypted && (
					<Button variant="outline" size="sm" onClick={() => setShowPanel(showPanel === 'embed' ? 'none' : 'embed')}>
						<Code2 className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Embed</span>
					</Button>
				)}
				<div className="flex-1" />
				<Button variant="destructive" size="sm" onClick={handleDelete}>
					<Trash2 className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Delete</span>
				</Button>
			</div>

			{/* ── QR Code panel ── */}
			{showPanel === 'qr' && (
				<div className="mt-3 flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-card animate-fade-in">
					<img
						src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pasteUrl)}`}
						alt="QR Code"
						width={200}
						height={200}
						className="rounded bg-white p-2"
					/>
					<p className="text-xs text-muted-foreground">Scan to open this paste</p>
				</div>
			)}

			{/* ── Embed panel ── */}
			{showPanel === 'embed' && (
				<div className="mt-3 p-4 rounded-lg border border-border bg-card animate-fade-in space-y-3">
					<p className="text-sm font-medium">Embed this paste</p>

					<div>
						<label className="text-xs text-muted-foreground mb-1 block">iframe</label>
						<div className="flex items-center gap-2">
							<code className="flex-1 text-xs bg-muted rounded-md p-2 overflow-x-auto whitespace-nowrap block">{embedSnippet}</code>
							<Button variant="ghost" size="sm" onClick={() => {
								navigator.clipboard.writeText(embedSnippet);
								toast({ message: 'Embed code copied!', type: 'success', duration: 2000 });
							}}>
								<Copy className="h-3.5 w-3.5" />
							</Button>
						</div>
					</div>

					<div>
						<label className="text-xs text-muted-foreground mb-1 block">Script tag (raw content)</label>
						<div className="flex items-center gap-2">
							<code className="flex-1 text-xs bg-muted rounded-md p-2 overflow-x-auto whitespace-nowrap block">{scriptSnippet}</code>
							<Button variant="ghost" size="sm" onClick={() => {
								navigator.clipboard.writeText(scriptSnippet);
								toast({ message: 'Script tag copied!', type: 'success', duration: 2000 });
							}}>
								<Copy className="h-3.5 w-3.5" />
							</Button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
