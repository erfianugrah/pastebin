import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../lib/utils';

interface ExpirationCountdownProps {
	expiresAt: string;
	className?: string;
}

export function ExpirationCountdown({ expiresAt, className = '' }: ExpirationCountdownProps) {
	const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, expired: false });
	const [isNearExpiry, setIsNearExpiry] = useState(false);

	useEffect(() => {
		const calculate = () => {
			const diff = new Date(expiresAt).getTime() - Date.now();
			if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };

			setIsNearExpiry(diff < 60 * 60 * 1000);
			return {
				days: Math.floor(diff / (1000 * 60 * 60 * 24)),
				hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
				minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
				seconds: Math.floor((diff % (1000 * 60)) / 1000),
				expired: false,
			};
		};

		setTimeLeft(calculate());
		const timer = setInterval(() => {
			const t = calculate();
			setTimeLeft(t);
			if (t.expired) clearInterval(timer);
		}, 1000);
		return () => clearInterval(timer);
	}, [expiresAt]);

	const format = () => {
		if (timeLeft.expired) return 'Expired';
		if (timeLeft.days > 0) return `${timeLeft.days}d ${timeLeft.hours}h`;
		if (timeLeft.hours > 0) return `${timeLeft.hours}h ${timeLeft.minutes}m`;
		if (timeLeft.minutes > 0) return `${timeLeft.minutes}m ${timeLeft.seconds}s`;
		return `${timeLeft.seconds}s`;
	};

	return (
		<span
			className={cn(
				'inline-flex items-center gap-1',
				timeLeft.expired
					? 'text-red-600 dark:text-red-400 font-bold'
					: isNearExpiry
						? 'text-red-600 dark:text-red-400'
						: timeLeft.days > 1
							? 'text-muted-foreground'
							: 'text-amber-600 dark:text-amber-400',
				className,
			)}
		>
			<Clock className="h-3.5 w-3.5" />
			{timeLeft.expired ? 'Expired' : `Expires in ${format()}`}
		</span>
	);
}
