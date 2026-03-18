import { useState, useEffect } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from './ui/button';

type Theme = 'light' | 'dark' | 'system';

const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];

export default function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>('system');
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
		const savedTheme = localStorage.getItem('theme') as Theme | null;
		const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

		if (savedTheme) {
			setTheme(savedTheme);
			document.documentElement.classList.add(savedTheme === 'system' ? systemTheme : savedTheme);
		} else {
			setTheme('system');
			document.documentElement.classList.add(systemTheme);
		}
	}, []);

	useEffect(() => {
		if (!mounted) return;

		localStorage.setItem('theme', theme);

		const root = document.documentElement;
		root.classList.remove('light', 'dark');

		if (theme === 'system') {
			const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
			root.classList.add(systemTheme);
		} else {
			root.classList.add(theme);
		}
	}, [theme, mounted]);

	useEffect(() => {
		if (!mounted) return;

		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

		const handleChange = () => {
			if (theme === 'system') {
				document.documentElement.classList.remove('light', 'dark');
				document.documentElement.classList.add(mediaQuery.matches ? 'dark' : 'light');
			}
		};

		mediaQuery.addEventListener('change', handleChange);
		return () => mediaQuery.removeEventListener('change', handleChange);
	}, [theme, mounted]);

	const cycleTheme = () => {
		const currentIndex = THEME_ORDER.indexOf(theme);
		const nextTheme = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length];
		setTheme(nextTheme);
	};

	if (!mounted) {
		return <div className="h-8 w-16 sm:w-20 rounded-md bg-muted/50 animate-pulse" aria-hidden="true" />;
	}

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
