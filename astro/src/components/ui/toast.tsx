import { useState, useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

export interface ToastProps {
	message: string;
	type?: 'success' | 'error' | 'info';
	duration?: number;
	onClose?: () => void;
}

export function Toast({ message, type = 'success', duration = 5000, onClose }: ToastProps) {
	const [isVisible, setIsVisible] = useState(true);
	const [isPaused, setIsPaused] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const remainingRef = useRef(duration);
	const startRef = useRef(Date.now());

	// Auto-dismiss with pause support
	useEffect(() => {
		if (isPaused) {
			if (timerRef.current) clearTimeout(timerRef.current);
			remainingRef.current -= Date.now() - startRef.current;
			return;
		}

		startRef.current = Date.now();
		timerRef.current = setTimeout(() => {
			setIsVisible(false);
			if (onClose) onClose();
		}, remainingRef.current);

		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [isPaused, onClose]);

	const typeClasses = {
		success: 'bg-green-100 border-green-600 text-green-950 dark:bg-green-900/50 dark:border-green-600 dark:text-green-100',
		error: 'bg-red-100 border-red-600 text-red-950 dark:bg-red-900/50 dark:border-red-600 dark:text-red-100',
		info: 'bg-blue-100 border-blue-600 text-blue-950 dark:bg-blue-900/50 dark:border-blue-600 dark:text-blue-100',
	};

	return isVisible ? (
		<div
			className={cn(
				'fixed bottom-20 right-4 px-4 py-3 rounded border-2 shadow-lg z-50 max-w-md transition-all transform backdrop-blur-sm',
				typeClasses[type],
				isVisible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
			)}
			role={type === 'error' ? 'alert' : 'status'}
			aria-live={type === 'error' ? 'assertive' : 'polite'}
			onMouseEnter={() => setIsPaused(true)}
			onMouseLeave={() => setIsPaused(false)}
			onFocus={() => setIsPaused(true)}
			onBlur={() => setIsPaused(false)}
		>
			<div className="flex items-center">
				{type === 'success' && (
					<svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
						<path
							fillRule="evenodd"
							d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
							clipRule="evenodd"
						/>
					</svg>
				)}
				{type === 'error' && (
					<svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
						<path
							fillRule="evenodd"
							d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
							clipRule="evenodd"
						/>
					</svg>
				)}
				{type === 'info' && (
					<svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
						<path
							fillRule="evenodd"
							d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v4a1 1 0 102 0V7zm-1-5a1 1 0 100 2 1 1 0 000-2z"
							clipRule="evenodd"
						/>
					</svg>
				)}
				<span>{message}</span>
				<button
					onClick={() => {
						setIsVisible(false);
						if (onClose) onClose();
					}}
					className="ml-4 text-current focus:outline-none focus-visible:ring-2 focus-visible:ring-current rounded"
					aria-label="Dismiss notification"
				>
					<svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
						<path
							fillRule="evenodd"
							d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
							clipRule="evenodd"
						/>
					</svg>
				</button>
			</div>
		</div>
	) : null;
}

// Global toast management using custom events for cross-component communication
const TOAST_EVENT = 'pasteriser-toast-event';

type ToastEvent = {
	id: number;
	props: ToastProps;
};

// Toast counter - module scoped (no need for localStorage)
let toastCounter = 0;
const getNextId = (): number => ++toastCounter;

// Create a toast
export function toast(props: Omit<ToastProps, 'onClose'>) {
	const id = getNextId();

	const event = new CustomEvent<ToastEvent>(TOAST_EVENT, {
		detail: {
			id,
			props: {
				...props,
				onClose: () => {
					window.dispatchEvent(
						new CustomEvent(`${TOAST_EVENT}-close`, {
							detail: { id },
						}),
					);
				},
			},
		},
	});

	window.dispatchEvent(event);
	return id;
}

// Toast container component
export function ToastContainer() {
	const [toasts, setToasts] = useState<ToastEvent[]>([]);

	useEffect(() => {
		const handleToastEvent = (event: Event) => {
			const toastEvent = (event as CustomEvent<ToastEvent>).detail;
			setToasts((prev) => [...prev, toastEvent]);
		};

		const handleToastCloseEvent = (event: Event) => {
			const { id } = (event as CustomEvent<{ id: number }>).detail;
			setToasts((prev) => prev.filter((toast) => toast.id !== id));
		};

		window.addEventListener(TOAST_EVENT, handleToastEvent);
		window.addEventListener(`${TOAST_EVENT}-close`, handleToastCloseEvent);

		return () => {
			window.removeEventListener(TOAST_EVENT, handleToastEvent);
			window.removeEventListener(`${TOAST_EVENT}-close`, handleToastCloseEvent);
		};
	}, []);

	return (
		<div aria-live="polite" aria-atomic="false">
			{toasts.map(({ id, props }) => (
				<Toast key={id} {...props} />
			))}
		</div>
	);
}
