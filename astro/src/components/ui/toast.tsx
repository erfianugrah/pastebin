import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ToastProps {
	message: string;
	type?: 'success' | 'error' | 'info';
	duration?: number;
	onClose?: () => void;
}

const ICONS = {
	success: CheckCircle2,
	error: XCircle,
	info: Info,
};

const TYPE_CLASSES = {
	success: 'bg-green-100 border-green-600 text-green-950 dark:bg-green-900/50 dark:border-green-600 dark:text-green-100',
	error: 'bg-red-100 border-red-600 text-red-950 dark:bg-red-900/50 dark:border-red-600 dark:text-red-100',
	info: 'bg-blue-100 border-blue-600 text-blue-950 dark:bg-blue-900/50 dark:border-blue-600 dark:text-blue-100',
};

export function Toast({ message, type = 'success', duration = 5000, onClose }: ToastProps) {
	const [isVisible, setIsVisible] = useState(true);
	const [isPaused, setIsPaused] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const remainingRef = useRef(duration);
	const startRef = useRef(Date.now());

	useEffect(() => {
		if (isPaused) {
			if (timerRef.current) clearTimeout(timerRef.current);
			remainingRef.current -= Date.now() - startRef.current;
			return;
		}
		startRef.current = Date.now();
		timerRef.current = setTimeout(() => {
			setIsVisible(false);
			onClose?.();
		}, remainingRef.current);
		return () => { if (timerRef.current) clearTimeout(timerRef.current); };
	}, [isPaused, onClose]);

	if (!isVisible) return null;

	const Icon = ICONS[type];

	return (
		<div
			className={cn(
				'px-4 py-3 rounded-lg border shadow-lg max-w-sm transition-all backdrop-blur-sm',
				TYPE_CLASSES[type],
			)}
			role={type === 'error' ? 'alert' : 'status'}
			aria-live={type === 'error' ? 'assertive' : 'polite'}
			onMouseEnter={() => setIsPaused(true)}
			onMouseLeave={() => setIsPaused(false)}
			onFocus={() => setIsPaused(true)}
			onBlur={() => setIsPaused(false)}
		>
			<div className="flex items-center gap-2">
				<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
				<span className="text-sm flex-1">{message}</span>
				<button
					onClick={() => { setIsVisible(false); onClose?.(); }}
					className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
					aria-label="Dismiss"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}

// ── Global toast management ──────────────────────────────────────────

const TOAST_EVENT = 'pasteriser-toast-event';
type ToastEvent = { id: number; props: ToastProps };
let toastCounter = 0;

export function toast(props: Omit<ToastProps, 'onClose'>) {
	const id = ++toastCounter;
	window.dispatchEvent(new CustomEvent<ToastEvent>(TOAST_EVENT, {
		detail: {
			id,
			props: {
				...props,
				onClose: () => {
					window.dispatchEvent(new CustomEvent(`${TOAST_EVENT}-close`, { detail: { id } }));
				},
			},
		},
	}));
	return id;
}

export function ToastContainer() {
	const [toasts, setToasts] = useState<ToastEvent[]>([]);

	useEffect(() => {
		const onAdd = (e: Event) => {
			const { detail } = e as CustomEvent<ToastEvent>;
			setToasts((prev) => [...prev, detail]);
		};
		const onRemove = (e: Event) => {
			const { id } = (e as CustomEvent<{ id: number }>).detail;
			setToasts((prev) => prev.filter((t) => t.id !== id));
		};
		window.addEventListener(TOAST_EVENT, onAdd);
		window.addEventListener(`${TOAST_EVENT}-close`, onRemove);
		return () => {
			window.removeEventListener(TOAST_EVENT, onAdd);
			window.removeEventListener(`${TOAST_EVENT}-close`, onRemove);
		};
	}, []);

	return (
		<div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite" aria-atomic="false">
			{toasts.map(({ id, props }) => (
				<Toast key={id} {...props} />
			))}
		</div>
	);
}
