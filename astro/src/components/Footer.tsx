import { useState } from 'react';
import { Modal } from './ui/modal';

export default function Footer() {
	const year = new Date().getFullYear();
	const [showAbout, setShowAbout] = useState(false);

	return (
		<footer className="border-t border-border mt-auto">
			<div className="max-w-4xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-2 text-sm text-muted-foreground">
				<span>&copy; {year} Erfi Anugrah</span>
				<nav className="flex items-center gap-4">
					<a href="/" className="hover:text-foreground transition-colors">Home</a>
					<a href="https://github.com/erfianugrah" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
						GitHub
					</a>
					<button onClick={() => setShowAbout(true)} className="hover:text-foreground transition-colors">
						About
					</button>
				</nav>
			</div>

			<Modal
				title="About Pasteriser"
				description="A modern, secure code sharing service."
				isOpen={showAbout}
				onClose={() => setShowAbout(false)}
				cancelText="Close"
			>
				<ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
					<li>End-to-end encryption (XSalsa20-Poly1305)</li>
					<li>Syntax highlighting for 30+ languages</li>
					<li>Password &amp; key-based protection</li>
					<li>Burn-after-reading &amp; view limits</li>
					<li>Custom expiration (1 hour to 1 year)</li>
				</ul>
			</Modal>
		</footer>
	);
}
