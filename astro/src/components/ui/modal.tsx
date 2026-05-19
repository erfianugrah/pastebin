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
	const uniqueId = React.useId().replace(/:/g, '');

	useEffect(() => {
		setIsMounted(true);
		return () => setIsMounted(false);
	}, []);

	// Focus trap and keyboard handling
	useEffect(() => {
		if (!isOpen) return;

		previouslyFocusedRef.current = document.activeElement as HTMLElement;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
				return;
			}

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
			previouslyFocusedRef.current?.focus();
		};
	}, [isOpen, onClose]);

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

	const titleId = 'modal-title-' + uniqueId;
	const descId = description ? 'modal-desc-' + uniqueId : undefined;

	const modal = (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
			<div className="fixed inset-0 z-0" onClick={onClose} aria-hidden="true" />
			<div
				ref={modalRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descId}
				className="relative z-10 w-full max-w-md bg-background border border-border animate-fade-in"
			>
				<div className="border-b border-border px-4 py-2.5">
					<h3 id={titleId} className="text-sm font-bold uppercase tracking-wide">
						{title}
					</h3>
				</div>

				<div className="px-4 py-3">
					{description && (
						<p id={descId} className="text-sm text-foreground">
							{description}
						</p>
					)}
					{children && <div className={description ? 'mt-3' : ''}>{children}</div>}
				</div>

				<div className="border-t border-border px-4 py-2.5 flex justify-end gap-2">
					<button
						onClick={onClose}
						className="btn h-7 px-2.5 text-xs border border-input bg-card text-foreground hover:bg-muted"
					>
						{cancelText}
					</button>
					{onConfirm && (
						<button
							onClick={onConfirm}
							className={cn(
								'btn h-7 px-2.5 text-xs border',
								isDangerous
									? 'border-destructive bg-card text-destructive hover:bg-destructive hover:text-destructive-foreground'
									: 'border-primary-hover bg-primary text-primary-foreground hover:bg-primary-hover',
							)}
						>
							{confirmText}
						</button>
					)}
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
