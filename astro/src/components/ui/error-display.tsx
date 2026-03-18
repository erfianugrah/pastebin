import React from 'react';
import { Zap, KeyRound, AlertTriangle, HardDrive, Clock, AlertCircle, RotateCcw } from 'lucide-react';
import { ErrorCategory } from '../../lib/errorTypes';
import { Button } from './button';
import { cn } from '../../lib/utils';

interface ErrorDisplayProps {
	message: string;
	category?: ErrorCategory;
	retry?: () => void;
	dismiss?: () => void;
	details?: string;
	showDetails?: boolean;
}

type CategoryStyle = {
	bg: string;
	border: string;
	text: string;
	icon: React.ReactNode;
};

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
	[ErrorCategory.NETWORK]: {
		bg: 'bg-orange-50 dark:bg-orange-900/20',
		border: 'border-orange-200 dark:border-orange-800',
		text: 'text-orange-800 dark:text-orange-300',
		icon: <Zap className="h-5 w-5 text-orange-500" />,
	},
	[ErrorCategory.CRYPTO]: {
		bg: 'bg-red-50 dark:bg-red-900/20',
		border: 'border-red-200 dark:border-red-800',
		text: 'text-red-800 dark:text-red-300',
		icon: <KeyRound className="h-5 w-5 text-red-500" />,
	},
	[ErrorCategory.VALIDATION]: {
		bg: 'bg-yellow-50 dark:bg-yellow-900/20',
		border: 'border-yellow-200 dark:border-yellow-800',
		text: 'text-yellow-800 dark:text-yellow-300',
		icon: <AlertTriangle className="h-5 w-5 text-yellow-500" />,
	},
	[ErrorCategory.STORAGE]: {
		bg: 'bg-purple-50 dark:bg-purple-900/20',
		border: 'border-purple-200 dark:border-purple-800',
		text: 'text-purple-800 dark:text-purple-300',
		icon: <HardDrive className="h-5 w-5 text-purple-500" />,
	},
	[ErrorCategory.TIMEOUT]: {
		bg: 'bg-blue-50 dark:bg-blue-900/20',
		border: 'border-blue-200 dark:border-blue-800',
		text: 'text-blue-800 dark:text-blue-300',
		icon: <Clock className="h-5 w-5 text-blue-500" />,
	},
};

const DEFAULT_STYLE: CategoryStyle = {
	bg: 'bg-gray-50 dark:bg-gray-900/20',
	border: 'border-gray-200 dark:border-gray-800',
	text: 'text-gray-800 dark:text-gray-300',
	icon: <AlertCircle className="h-5 w-5 text-gray-500" />,
};

export function ErrorDisplay({
	message,
	category = ErrorCategory.UNKNOWN,
	retry,
	dismiss,
	details,
	showDetails = false,
}: ErrorDisplayProps) {
	const [expanded, setExpanded] = React.useState(showDetails);
	const s = CATEGORY_STYLES[category] ?? DEFAULT_STYLE;

	return (
		<div className={cn('rounded-lg border p-4 my-4', s.bg, s.border)}>
			<div className="flex items-start gap-3">
				<div className="shrink-0">{s.icon}</div>
				<div className="flex-1 min-w-0">
					<p className={cn('text-sm font-medium', s.text)}>{message}</p>

					{details && (
						<div className="mt-2">
							<button
								type="button"
								onClick={() => setExpanded(!expanded)}
								className={cn('text-sm font-medium underline', s.text)}
							>
								{expanded ? 'Hide details' : 'Show details'}
							</button>

							{expanded && (
								<pre className={cn('mt-2 text-xs whitespace-pre-wrap overflow-auto max-h-64 p-2 rounded border font-mono', s.bg, s.border)}>
									{details}
								</pre>
							)}
						</div>
					)}

					{(retry || dismiss) && (
						<div className="mt-3 flex gap-2">
							{retry && (
								<Button size="sm" onClick={retry}>
									<RotateCcw className="h-3 w-3 mr-1.5" /> Retry
								</Button>
							)}
							{dismiss && (
								<Button size="sm" variant="outline" onClick={dismiss}>
									Dismiss
								</Button>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
