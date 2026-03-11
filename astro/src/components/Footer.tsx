import { useState } from 'react';
import { Modal } from './ui/modal';

export default function Footer() {
	const year = new Date().getFullYear();
	const [showAbout, setShowAbout] = useState(false);

	return (
		<footer className="border-t border-border bg-background mt-8">
			<div className="container mx-auto px-4 py-6">
				<div className="flex flex-col sm:flex-row justify-between items-center">
					<div className="text-sm text-muted-foreground">© {year} Erfi Anugrah</div>
					<div className="text-sm text-muted-foreground mt-2 sm:mt-0">
						<ul className="flex space-x-4">
							<li>
								<a href="/" className="hover:text-foreground transition-colors">
									Home
								</a>
							</li>
							<li>
								<a
									href="https://github.com/erfianugrah"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-foreground transition-colors"
								>
									GitHub
								</a>
							</li>
							<li>
								<button
									onClick={() => setShowAbout(true)}
									className="hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-0 m-0"
								>
									About
								</button>
							</li>
						</ul>
					</div>
				</div>
			</div>

			<Modal
				title="About Pasteriser"
				description="A modern, secure code sharing service"
				isOpen={showAbout}
				onClose={() => setShowAbout(false)}
				cancelText="Close"
			>
				<ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
					<li>Enhanced syntax highlighting with line numbers</li>
					<li>Code formatting and auto-indentation</li>
					<li>Password protection</li>
					<li>Burn after reading</li>
					<li>Custom expiration times</li>
					<li>Dark mode support</li>
				</ul>
			</Modal>
		</footer>
	);
}
