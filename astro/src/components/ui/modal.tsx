import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

interface ModalProps {
	title: string;
	description?: string;
	isOpen: boolean;
	onClose: () => void;
	onConfirm?: () => void;
	children?: React.ReactNode;
	confirmText?: string;
	cancelText?: string;
	isDangerous?: boolean;
}

export function Modal({
	title,
	description,
	isOpen,
	onClose,
	onConfirm,
	children,
	confirmText = 'Confirm',
	cancelText = 'Cancel',
	isDangerous = false,
}: ModalProps) {
	const [isMounted, setIsMounted] = useState(false);
	const modalRef = useRef<HTMLDivElement>(null);
	const previouslyFocusedRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		setIsMounted(true);
		return () => setIsMounted(false);
	}, []);

	// Focus trap and keyboard handling
	useEffect(() => {
		if (!isOpen) return;

		// Save currently focused element to restore later
		previouslyFocusedRef.current = document.activeElement as HTMLElement;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
				return;
			}

			// Focus trap: Tab and Shift+Tab cycle within modal
			if (e.key === 'Tab' && modalRef.current) {
				const focusable = modalRef.current.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
				const first = focusable[0];
				const last = focusable[focusable.length - 1];

				if (e.shiftKey) {
					if (document.activeElement === first) {
						e.preventDefault();
						last?.focus();
					}
				} else {
					if (document.activeElement === last) {
						e.preventDefault();
						first?.focus();
					}
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);

		// Focus the first focusable element in the modal
		requestAnimationFrame(() => {
			if (modalRef.current) {
				const firstFocusable = modalRef.current.querySelector<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
				firstFocusable?.focus();
			}
		});

		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			// Restore focus to the previously focused element
			previouslyFocusedRef.current?.focus();
		};
	}, [isOpen, onClose]);

	// Prevent scrolling when modal is open
	useEffect(() => {
		if (isOpen) {
			document.body.style.overflow = 'hidden';
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [isOpen]);

	if (!isMounted || !isOpen) return null;

	const titleId = 'modal-title-' + React.useId().replace(/:/g, '');
	const descId = description ? 'modal-desc-' + titleId : undefined;

	const modal = (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/25 backdrop-blur-sm">
			<div className="fixed inset-0 z-0" onClick={onClose} aria-hidden="true" />
			<div
				ref={modalRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descId}
				className="relative z-10 w-full max-w-md overflow-hidden rounded-lg bg-background shadow-lg border border-border animate-in fade-in zoom-in-95"
			>
				<div className="p-6">
					<h3 id={titleId} className="text-lg font-semibold">
						{title}
					</h3>
					{description && (
						<p id={descId} className="mt-2 text-sm text-muted-foreground">
							{description}
						</p>
					)}
					{children && <div className="mt-4">{children}</div>}

					<div className="mt-6 flex justify-end gap-3">
						<button
							onClick={onClose}
							className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm border border-border hover:bg-secondary/80 transition-colors"
						>
							{cancelText}
						</button>
						{onConfirm && (
							<button
								onClick={onConfirm}
								className={cn(
									'px-4 py-2 rounded-md text-sm',
									isDangerous
										? 'bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20'
										: 'bg-primary text-primary-foreground hover:bg-primary/90',
								)}
							>
								{confirmText}
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);

	return createPortal(modal, document.body);
}

// Utility function to show a confirmation modal using proper React rendering
export function showConfirmModal(props: Omit<ModalProps, 'isOpen' | 'onClose'>): Promise<boolean> {
	return new Promise((resolve) => {
		const container = document.createElement('div');
		document.body.appendChild(container);

		import('react-dom/client').then((ReactDOMClient: any) => {
			const root = ReactDOMClient.createRoot(container);

			const cleanup = () => {
				root.unmount();
				container.remove();
			};

			const handleConfirm = () => {
				resolve(true);
				cleanup();
			};

			const handleCancel = () => {
				resolve(false);
				cleanup();
			};

			root.render(
				React.createElement(Modal, {
					...props,
					isOpen: true,
					onClose: handleCancel,
					onConfirm: handleConfirm,
				}),
			);
		});
	});
}
