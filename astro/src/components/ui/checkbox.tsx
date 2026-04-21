import * as React from 'react';
import { cn } from '../../lib/utils';

const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
	({ className, ...props }, ref) => (
		<span className={cn('relative inline-flex h-4 w-4 shrink-0', className)}>
			<input
				type="checkbox"
				ref={ref}
				className="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
				{...props}
			/>
			<span
				className={cn(
					'pointer-events-none absolute inset-0 rounded-[4px] border transition-colors',
					'border-muted-foreground/40 bg-background',
					'peer-checked:border-primary peer-checked:bg-primary',
					'peer-focus-visible:ring-1 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1',
					'peer-disabled:opacity-50',
				)}
			/>
			<svg
				className="pointer-events-none absolute inset-0 m-[2px] text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100"
				viewBox="0 0 16 16"
				fill="currentColor"
			>
				<path d="M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0z" />
			</svg>
		</span>
	),
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
