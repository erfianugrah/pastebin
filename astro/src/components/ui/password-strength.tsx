import { useState, useEffect } from 'react';
import { CircleDot } from 'lucide-react';
import { evaluatePasswordStrength } from '../../lib/passwordStrength';
import type { PasswordFeedback } from '../../lib/passwordStrength';
import { T } from '../../lib/typography';

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
		color: 'var(--color-red-500, #ef4444)',
	});

	useEffect(() => {
		setFeedback(evaluatePasswordStrength(password));
	}, [password]);

	if (!password && !feedback.score) return null;

	return (
		<div className={`mt-2 ${className}`}>
			<div className="flex items-center justify-between mb-1">
				<span className={T.muted}>Password strength:</span>
				<span className="text-xs font-medium capitalize" style={{ color: feedback.color }}>
					{feedback.strength}
				</span>
			</div>

			<div className="h-1 w-full bg-muted rounded-full overflow-hidden">
				<div
					className="h-full rounded-full transition-all duration-300"
					style={{ width: `${feedback.score}%`, backgroundColor: feedback.color }}
				/>
			</div>

			{showSuggestions && feedback.suggestions.length > 0 && (
				<ul className="mt-2 space-y-0.5">
					{feedback.suggestions.map((suggestion, i) => (
						<li key={i} className={`flex items-start gap-1.5 ${T.muted}`}>
							<CircleDot className="h-3 w-3 mt-0.5 shrink-0" />
							{suggestion}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
