import { useState } from 'react';
import { Modal } from './ui/modal';

export default function Footer() {
	const year = new Date().getFullYear();
	const [showAbout, setShowAbout] = useState(false);

	return (
		<footer className="border-t border-border mt-auto">
			<div className="max-w-5xl mx-auto px-4 py-2 flex flex-wrap justify-between items-center gap-2 text-xs text-muted-foreground">
				<span>© {year} Erfi Anugrah</span>
				<nav className="flex items-center gap-3">
					<a
						href="https://github.com/erfianugrah"
						target="_blank"
						rel="noopener noreferrer"
						className="nav-link hover:underline"
					>
						GitHub
					</a>
					<button onClick={() => setShowAbout(true)} className="nav-link hover:underline">
						About
					</button>
				</nav>
			</div>

			<Modal
				title="About Pasteriser"
				description="A code-sharing service. End-to-end encryption, syntax highlighting, burn-after-reading, full-text search."
				isOpen={showAbout}
				onClose={() => setShowAbout(false)}
				cancelText="Close"
			>
				<ul className="space-y-1 text-sm">
					<li>— End-to-end encryption (XSalsa20-Poly1305)</li>
					<li>— Syntax highlighting for 30+ languages</li>
					<li>— Password &amp; key-based protection</li>
					<li>— Burn-after-reading &amp; view limits</li>
					<li>— Custom expiration (1 hour to 1 year)</li>
				</ul>
			</Modal>
		</footer>
	);
}
