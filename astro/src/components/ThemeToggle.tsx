import { useState, useEffect } from 'react';

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

	useEffect(() => {
		const saved = localStorage.getItem('theme') as Theme | null;
		if (saved && THEME_ORDER.includes(saved)) {
			setTheme(saved);
			applyTheme(saved);
		}
	}, []);

	useEffect(() => {
		localStorage.setItem('theme', theme);
		applyTheme(theme);
	}, [theme]);

	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const handler = () => {
			if (theme === 'system') applyTheme('system');
		};
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, [theme]);

	const cycleTheme = () => {
		setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]);
	};

	const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto';

	return (
		<button
			onClick={cycleTheme}
			className="text-xs uppercase tracking-wide text-foreground hover:underline"
			aria-label={`Theme: ${label}. Click to cycle.`}
			title={`Theme: ${label}`}
		>
			[{label}]
		</button>
	);
}
