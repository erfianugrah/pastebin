import { useState, useEffect } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from './ui/button';

type Theme = 'light' | 'dark' | 'system';

const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	root.classList.remove('light', 'dark');
	if (theme === 'system') {
		root.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
	} else {
		root.classList.add(theme);
	}
}

export default function ThemeToggle() {
	// Always start with 'system' for SSR consistency
	const [theme, setTheme] = useState<Theme>('system');

	// On mount: read saved preference
	useEffect(() => {
		const saved = localStorage.getItem('theme') as Theme | null;
		if (saved && THEME_ORDER.includes(saved)) {
			setTheme(saved);
			applyTheme(saved);
		}
	}, []);

	// When theme changes: persist and apply
	useEffect(() => {
		localStorage.setItem('theme', theme);
		applyTheme(theme);
	}, [theme]);

	// Listen for system preference changes
	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = () => { if (theme === 'system') applyTheme('system'); };
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, [theme]);

	const cycleTheme = () => {
		setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]);
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
