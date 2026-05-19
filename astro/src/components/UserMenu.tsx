import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function UserMenu() {
	const { user, loading, signOut } = useAuth();
	const [open, setOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function onClick(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener('mousedown', onClick);
		return () => document.removeEventListener('mousedown', onClick);
	}, [open]);

	if (loading) {
		return <span className="text-xs uppercase tracking-wide text-muted-foreground">…</span>;
	}

	if (!user) {
		return (
			<a href="/login" className="nav-link text-xs uppercase tracking-wide hover:underline">
				Log in
			</a>
		);
	}

	const email = user.email ?? 'user';
	const handle = email.split('@')[0];

	return (
		<div ref={menuRef} className="relative">
			<button
				onClick={() => setOpen((o) => !o)}
				className="text-xs uppercase tracking-wide text-foreground hover:underline"
				aria-label="User menu"
				aria-expanded={open}
			>
				{handle}@
			</button>

			{open && (
				<div className="absolute right-0 mt-px w-56 border border-border bg-popover animate-fade-in z-50">
					<div className="px-2.5 py-1.5 border-b border-border">
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">Signed in as</div>
						<div className="text-xs truncate" title={email}>
							{email}
						</div>
					</div>
					<a
						href="/my"
						className="nav-link block px-2.5 py-1.5 text-xs hover:bg-muted"
						onClick={() => setOpen(false)}
					>
						My pastes
					</a>
					<button
						onClick={async () => {
							setOpen(false);
							await signOut();
							window.location.href = '/';
						}}
						className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted"
					>
						Sign out
					</button>
				</div>
			)}
		</div>
	);
}
