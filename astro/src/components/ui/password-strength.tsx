import { useState, useEffect } from 'react';
import { evaluatePasswordStrength } from '../../lib/passwordStrength';
import type { PasswordFeedback } from '../../lib/passwordStrength';

interface PasswordStrengthMeterProps {
	password: string;
	showSuggestions?: boolean;
	className?: string;
}

export function PasswordStrengthMeter({
	password,
	showSuggestions = true,
	className = '',
}: PasswordStrengthMeterProps) {
	const [feedback, setFeedback] = useState<PasswordFeedback>({
		strength: 'weak',
		score: 0,
		suggestions: [],
		color: 'var(--color-destructive, #c83030)',
	});

	useEffect(() => {
		setFeedback(evaluatePasswordStrength(password));
	}, [password]);

	if (!password && !feedback.score) return null;

	return (
		<div className={`mt-1 ${className}`}>
			<div className="flex items-center justify-between mb-0.5">
				<span className="text-[10px] uppercase tracking-wide text-muted-foreground">Strength</span>
				<span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: feedback.color }}>
					{feedback.strength}
				</span>
			</div>

			<div className="h-1 w-full bg-muted overflow-hidden border border-border">
				<div
					className="h-full"
					style={{ width: `${feedback.score}%`, backgroundColor: feedback.color }}
				/>
			</div>

			{showSuggestions && feedback.suggestions.length > 0 && (
				<ul className="mt-1 space-y-0.5">
					{feedback.suggestions.map((suggestion, i) => (
						<li key={i} className="text-[11px] text-muted-foreground">
							— {suggestion}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
