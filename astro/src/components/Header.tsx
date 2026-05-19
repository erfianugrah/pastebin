import ThemeToggle from './ThemeToggle';
import UserMenu from './UserMenu';

// ─── McMaster brutalist header ───────────────────────────────────────
// One thin row, sticky, hard 1px border bottom. Brand on the left, nav
// + auth on the right. No icons, no scroll-aware blur. Mobile collapses
// nav into a horizontally-scrollable row — clarity > responsive hiding.

export default function Header() {
	return (
		<header className="sticky top-0 z-40 w-full border-b border-border-strong bg-background">
			<div className="max-w-5xl mx-auto px-4 h-9 flex items-center gap-4">
				<a
					href="/"
					className="nav-link font-bold text-sm tracking-wide hover:bg-primary hover:text-primary-foreground px-1.5 h-9 inline-flex items-center"
					aria-label="Pasteriser — home"
				>
					PASTERISER
				</a>

				<nav className="flex-1 flex items-center gap-3 overflow-x-auto" aria-label="Main navigation">
					<a href="/" className="nav-link text-xs uppercase tracking-wide hover:underline">
						New
					</a>
					<a href="/recent" className="nav-link text-xs uppercase tracking-wide hover:underline">
						Recent
					</a>
					<a href="/my" className="nav-link text-xs uppercase tracking-wide hover:underline">
						Mine
					</a>
				</nav>

				<div className="flex items-center gap-3 shrink-0">
					<ThemeToggle />
					<UserMenu />
				</div>
			</div>
		</header>
	);
}
