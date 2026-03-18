import { useState } from 'react';
import { Plus, FileText, Trash2, Copy, Download, GitFork, QrCode } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from './ui/toast';
import { showConfirmModal } from './ui/modal';

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
	const [showQr, setShowQr] = useState(false);

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
		if (!navigator.clipboard) {
			toast({ message: 'Clipboard not available.', type: 'error', duration: 3000 });
			return;
		}
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
		// Navigate to home with content in sessionStorage (avoids URL length limits)
		sessionStorage.setItem('pasteriser_fork', JSON.stringify({
			content: text,
			title: pasteTitle ? `Fork of ${pasteTitle}` : undefined,
			language: pasteLanguage,
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
			window.location.href = `/pastes/${pasteId}/delete`;
		}
	};

	const pasteUrl = typeof window !== 'undefined' ? window.location.href : '';

	return (
		<>
			<div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm" asChild>
					<a href="/"><Plus className="h-3.5 w-3.5 mr-1.5" /> New</a>
				</Button>
				<Button variant="outline" size="sm" onClick={handleFork}>
					<GitFork className="h-3.5 w-3.5 mr-1.5" /> Fork
				</Button>
				<Button variant="outline" size="sm" onClick={handleViewRaw}>
					<FileText className="h-3.5 w-3.5 mr-1.5" /> Raw
				</Button>
				<Button variant="outline" size="sm" onClick={handleCopy}>
					<Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
				</Button>
				<Button variant="outline" size="sm" onClick={handleDownload}>
					<Download className="h-3.5 w-3.5 mr-1.5" /> Download
				</Button>
				<Button variant="outline" size="sm" onClick={() => setShowQr(!showQr)}>
					<QrCode className="h-3.5 w-3.5 mr-1.5" /> QR
				</Button>
				<div className="flex-1" />
				<Button variant="destructive" size="sm" onClick={handleDelete}>
					<Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
				</Button>
			</div>

			{/* QR Code (rendered as SVG using a simple generator) */}
			{showQr && (
				<div className="mt-3 flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-card">
					<QrCodeSvg value={pasteUrl} />
					<p className="text-xs text-muted-foreground">Scan to open this paste</p>
				</div>
			)}
		</>
	);
}

// ── Simple QR Code SVG generator ─────────────────────────────────────
// Uses a basic encoding — for production, consider a library like `qrcode`.
// This generates a QR Code API image for simplicity.

function QrCodeSvg({ value }: { value: string }) {
	// Use a simple approach: Google Charts QR API (public, no key needed)
	const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(value)}`;
	return (
		<img
			src={qrUrl}
			alt="QR Code"
			width={200}
			height={200}
			className="rounded bg-white p-2"
		/>
	);
}
