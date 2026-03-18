import { useState, useEffect } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from './ui/button';

type Theme = 'light' | 'dark' | 'system';

const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];

export default function ThemeToggle() {
	// Read initial theme synchronously to avoid flash
	const [theme, setTheme] = useState<Theme>(() => {
		if (typeof window === 'undefined') return 'system';
		return (localStorage.getItem('theme') as Theme) || 'system';
	});

	// Apply theme class whenever theme changes
	useEffect(() => {
		const root = document.documentElement;
		root.classList.remove('light', 'dark');

		if (theme === 'system') {
			const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
			root.classList.add(systemTheme);
		} else {
			root.classList.add(theme);
		}

		localStorage.setItem('theme', theme);
	}, [theme]);

	// Listen for system preference changes
	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = () => {
			if (theme === 'system') {
				document.documentElement.classList.remove('light', 'dark');
				document.documentElement.classList.add(mq.matches ? 'dark' : 'light');
			}
		};
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, [theme]);

	const cycleTheme = () => {
		const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
		setTheme(next);
	};

	const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
	const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System';

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={cycleTheme}
			className="gap-1.5 px-2.5"
			aria-label={`Theme: ${label}. Click to change.`}
			title={`Theme: ${label}`}
		>
			<Icon className="h-4 w-4" />
			<span className="hidden sm:inline text-xs">{label}</span>
		</Button>
	);
}
