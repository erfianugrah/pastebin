import React from 'react';
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

// ─── McMaster brutalist error display ───────────────────────────────
// One panel style — bordered notice with a coloured top border + label
// strip. No icon chrome, no rounded corners, no shadows. Category drives
// the accent colour only.

const CATEGORY_LABELS: Record<string, { label: string; tone: 'destructive' | 'warning' | 'info' | 'success' }> = {
	[ErrorCategory.NETWORK]: { label: 'NETWORK', tone: 'warning' },
	[ErrorCategory.CRYPTO]: { label: 'CRYPTO', tone: 'destructive' },
	[ErrorCategory.VALIDATION]: { label: 'INVALID', tone: 'warning' },
	[ErrorCategory.STORAGE]: { label: 'STORAGE', tone: 'warning' },
	[ErrorCategory.TIMEOUT]: { label: 'TIMEOUT', tone: 'warning' },
};

const DEFAULT_LABEL = { label: 'ERROR', tone: 'destructive' as const };

export function ErrorDisplay({
	message,
	category = ErrorCategory.UNKNOWN,
	retry,
	dismiss,
	details,
	showDetails = false,
}: ErrorDisplayProps) {
	const [expanded, setExpanded] = React.useState(showDetails);
	const s = CATEGORY_LABELS[category] ?? DEFAULT_LABEL;
	const noticeClass = `notice notice-${s.tone}`;

	return (
		<div className={cn(noticeClass, 'block my-3 p-0')}>
			<div
				className={cn(
					'border-b px-3 py-1 text-xs font-bold uppercase tracking-wide bg-card-alt',
					s.tone === 'destructive' && 'text-destructive border-destructive',
					s.tone === 'warning' && 'text-warning border-warning',
					s.tone === 'info' && 'text-info border-info',
					s.tone === 'success' && 'text-success border-success',
				)}
			>
				× {s.label}
			</div>
			<div className="px-3 py-2 space-y-2">
				<p className="text-sm">{message}</p>

				{details && (
					<div>
						<button
							type="button"
							onClick={() => setExpanded(!expanded)}
							className="text-xs uppercase tracking-wide text-link underline"
						>
							{expanded ? '[hide details]' : '[show details]'}
						</button>

						{expanded && (
							<pre className="mt-1 text-xs whitespace-pre-wrap overflow-auto max-h-64 p-2 border border-border bg-card-alt font-mono">
								{details}
							</pre>
						)}
					</div>
				)}

				{(retry || dismiss) && (
					<div className="flex gap-2 pt-1">
						{retry && (
							<Button onClick={retry}>Retry</Button>
						)}
						{dismiss && (
							<Button variant="ghost" onClick={dismiss}>
								Dismiss
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
