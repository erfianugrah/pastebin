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
				toast({ message: 'Content is still being decrypted. Please wait.', type: 'info', duration: 2000 });
			}
		} else {
			window.open(`/pastes/raw/${pasteId}`, '_blank');
		}
	};

	const handleDelete = async () => {
		const confirmed = await showConfirmModal({
			title: 'Delete Paste',
			description: 'Are you sure you want to delete this paste? This action cannot be undone.',
			confirmText: 'Delete',
			cancelText: 'Cancel',
			isDangerous: true,
		});
		if (confirmed) {
			window.location.href = `/pastes/${pasteId}/delete`;
		}
	};

	const handleCopy = async () => {
		const contentToCopy = isEncrypted ? getDecryptedContent() : getRawContent();

		if (!contentToCopy) {
			toast({
				message: isEncrypted ? 'Content is still being decrypted. Please wait.' : 'No content to copy.',
				type: isEncrypted ? 'info' : 'error',
				duration: 2000,
			});
			return;
		}

		if (navigator.clipboard) {
			try {
				await navigator.clipboard.writeText(contentToCopy);
				toast({ message: 'Copied to clipboard!', type: 'success', duration: 2000 });
			} catch {
				toast({ message: 'Failed to copy to clipboard', type: 'error', duration: 3000 });
			}
		} else {
			toast({ message: 'Clipboard access not available in your browser', type: 'error', duration: 3000 });
		}
	};

	return (
		<div className="mt-6 border-t border-border pt-4 flex justify-between items-center flex-wrap gap-3">
			<div className="flex flex-wrap gap-2">
				<a href="/">
					<Button variant="secondary" size="sm">
						Create New Paste
					</Button>
				</a>
				<Button variant="secondary" size="sm" onClick={handleViewRaw}>
					View Raw
				</Button>
				<Button variant="destructive" size="sm" onClick={handleDelete}>
					Delete
				</Button>
			</div>
			<div className="flex gap-2">
				<Button variant="secondary" size="sm" onClick={handleCopy}>
					Copy to Clipboard
				</Button>
			</div>
		</div>
	);
}
