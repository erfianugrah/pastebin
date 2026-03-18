import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function Header() {
	const [isScrolled, setIsScrolled] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	useEffect(() => {
		const handleScroll = () => setIsScrolled(window.scrollY > 10);
		window.addEventListener('scroll', handleScroll);
		return () => window.removeEventListener('scroll', handleScroll);
	}, []);

	useEffect(() => {
		if (!isMenuOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setIsMenuOpen(false);
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [isMenuOpen]);

	return (
		<header
			className={`sticky top-0 z-40 w-full border-b border-border transition-shadow ${
				isScrolled ? 'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm' : 'bg-background'
			}`}
		>
			<div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
				<a href="/" className="text-lg font-semibold tracking-tight hover:text-primary transition-colors">
					Pasteriser
				</a>

				<div className="flex items-center gap-4">
					<nav className="hidden md:flex items-center gap-6" aria-label="Main navigation">
						<a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
							New
						</a>
						<a href="/recent" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
							Recent
						</a>
					</nav>

					<ThemeToggle />

					<button
						className="md:hidden p-1.5 rounded-md hover:bg-muted transition-colors"
						onClick={() => setIsMenuOpen(!isMenuOpen)}
						aria-label="Toggle menu"
						aria-expanded={isMenuOpen}
						aria-controls="mobile-menu"
					>
						{isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
					</button>
				</div>
			</div>

			{/* Mobile menu */}
			{isMenuOpen && (
				<div id="mobile-menu" className="md:hidden border-t border-border">
					<nav className="max-w-4xl mx-auto px-4 py-3 flex flex-col gap-1" aria-label="Mobile navigation">
						<a href="/" className="py-2 px-3 rounded-md text-sm hover:bg-muted transition-colors" onClick={() => setIsMenuOpen(false)}>
							New Paste
						</a>
						<a href="/recent" className="py-2 px-3 rounded-md text-sm hover:bg-muted transition-colors" onClick={() => setIsMenuOpen(false)}>
							Recent Pastes
						</a>
					</nav>
				</div>
			)}
		</header>
	);
}
