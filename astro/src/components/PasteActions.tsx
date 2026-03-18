import { Plus, FileText, Trash2, Copy } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from './ui/toast';
import { showConfirmModal } from './ui/modal';

interface PasteActionsProps {
	pasteId: string;
	isEncrypted: boolean;
	getDecryptedContent: () => string | null;
	getRawContent: () => string;
}

export default function PasteActions({ pasteId, isEncrypted, getDecryptedContent, getRawContent }: PasteActionsProps) {
	const handleViewRaw = () => {
		if (isEncrypted) {
			const decrypted = getDecryptedContent();
			if (decrypted) {
				const blob = new Blob([decrypted], { type: 'text/plain' });
				const url = URL.createObjectURL(blob);
				window.open(url, '_blank');
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			} else {
				toast({ message: 'Content is still being decrypted.', type: 'info', duration: 2000 });
			}
		} else {
			window.open(`/pastes/raw/${pasteId}`, '_blank');
		}
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

	const handleCopy = async () => {
		const text = isEncrypted ? getDecryptedContent() : getRawContent();
		if (!text) {
			toast({ message: isEncrypted ? 'Still decrypting...' : 'No content to copy.', type: 'info', duration: 2000 });
			return;
		}
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

	return (
		<div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center gap-2">
			<Button variant="outline" size="sm" asChild>
				<a href="/"><Plus className="h-3.5 w-3.5 mr-1.5" /> New</a>
			</Button>
			<Button variant="outline" size="sm" onClick={handleViewRaw}>
				<FileText className="h-3.5 w-3.5 mr-1.5" /> Raw
			</Button>
			<Button variant="outline" size="sm" onClick={handleCopy}>
				<Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
			</Button>
			<div className="flex-1" />
			<Button variant="destructive" size="sm" onClick={handleDelete}>
				<Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
			</Button>
		</div>
	);
}
