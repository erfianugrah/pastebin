import * as React from 'react';
import { cn } from '../../lib/utils';

const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
	({ className, ...props }, ref) => (
		<span className={cn('relative inline-flex h-3.5 w-3.5 shrink-0 align-middle', className)}>
			<input
				type="checkbox"
				ref={ref}
				className="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
				{...props}
			/>
			<span
				className={cn(
					'pointer-events-none absolute inset-0 border transition-none',
					'border-border-strong bg-card',
					'peer-checked:border-primary-hover peer-checked:bg-primary',
					'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-foreground',
					'peer-disabled:opacity-50',
				)}
			/>
			<svg
				className="pointer-events-none absolute inset-0 m-px text-primary-foreground opacity-0 peer-checked:opacity-100"
				viewBox="0 0 16 16"
				fill="currentColor"
				aria-hidden="true"
			>
				<path d="M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0z" />
			</svg>
		</span>
	),
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
