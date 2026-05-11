import { useState, useRef, useEffect } from 'react';
import { LogIn, LogOut, User as UserIcon, FolderOpen } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { AUTH_ENABLED } from '../lib/supabase';
import { Button } from './ui/button';

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

	if (!AUTH_ENABLED) return null;

	if (loading) {
		return <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />;
	}

	if (!user) {
		return (
			<Button variant="ghost" size="sm" asChild>
				<a href="/login" className="inline-flex items-center gap-1.5">
					<LogIn className="h-4 w-4" /> Log in
				</a>
			</Button>
		);
	}

	const initial = (user.email?.[0] ?? 'U').toUpperCase();

	return (
		<div ref={menuRef} className="relative">
			<button
				onClick={() => setOpen((o) => !o)}
				className="h-8 w-8 rounded-full bg-primary/10 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors flex items-center justify-center"
				aria-label="User menu"
				aria-expanded={open}
			>
				{initial}
			</button>

			{open && (
				<div className="absolute right-0 mt-2 w-56 rounded-md border bg-popover shadow-md py-1 z-50">
					<div className="px-3 py-2 border-b">
						<div className="text-xs text-muted-foreground">Signed in as</div>
						<div className="text-sm truncate" title={user.email ?? ''}>
							{user.email}
						</div>
					</div>
					<a
						href="/my"
						className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
						onClick={() => setOpen(false)}
					>
						<FolderOpen className="h-4 w-4" /> My Pastes
					</a>
					<button
						onClick={async () => {
							setOpen(false);
							await signOut();
							// Reload so server-rendered content reflects the signed-out state
							window.location.href = '/';
						}}
						className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
					>
						<LogOut className="h-4 w-4" /> Sign out
					</button>
				</div>
			)}
		</div>
	);
}
