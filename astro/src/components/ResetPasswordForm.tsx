import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, LogIn } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

type State =
	| { kind: 'form' }
	| { kind: 'error'; message: string }
	| { kind: 'done' };

export default function ResetPasswordForm() {
	const { user, loading, updatePassword } = useAuth();
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [state, setState] = useState<State>({ kind: 'form' });
	const [submitting, setSubmitting] = useState(false);

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		if (password.length < 6) {
			setState({ kind: 'error', message: 'Password must be at least 6 characters' });
			return;
		}
		if (password !== confirm) {
			setState({ kind: 'error', message: 'Passwords do not match' });
			return;
		}
		setSubmitting(true);
		try {
			const { error } = await updatePassword(password);
			if (error) {
				setState({ kind: 'error', message: error.message });
			} else {
				setState({ kind: 'done' });
			}
		} finally {
			setSubmitting(false);
		}
	}

	// User landed here directly (no recovery cookie). The /auth/confirm
	// flow normally sets cookies before sending them to this page, so an
	// unauthenticated visit usually means: an expired link, a different
	// browser, or someone typing the URL directly.
	if (loading) {
		return (
			<Card>
				<CardContent className="p-6">
					<div className="h-5 w-32 rounded-md bg-muted animate-pulse" />
				</CardContent>
			</Card>
		);
	}

	if (!user) {
		return (
			<Card>
				<CardContent className="p-6 text-center">
					<div className="mx-auto rounded-full w-12 h-12 bg-muted flex items-center justify-center mb-4">
						<LogIn className="h-5 w-5 text-muted-foreground" />
					</div>
					<h2 className="text-lg font-semibold tracking-tight mb-2">Session needed</h2>
					<p className="text-sm text-muted-foreground mb-4">
						To set a new password, click the link in the password-reset email we sent you.
						Links expire after a short time — request a new one if needed.
					</p>
					<Button asChild className="w-full">
						<a href="/forgot-password">Request a reset link</a>
					</Button>
				</CardContent>
			</Card>
		);
	}

	if (state.kind === 'done') {
		return (
			<Card>
				<CardContent className="p-6 text-center">
					<div className="mx-auto rounded-full w-12 h-12 bg-primary/10 flex items-center justify-center mb-4">
						<CheckCircle2 className="h-5 w-5 text-primary" />
					</div>
					<h2 className="text-lg font-semibold tracking-tight mb-2">Password updated</h2>
					<p className="text-sm text-muted-foreground mb-4">
						You can continue using your account with the new password.
					</p>
					<Button asChild className="w-full">
						<a href="/my">Go to my pastes</a>
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardContent className="p-6">
				<div className="mx-auto rounded-full w-12 h-12 bg-primary/10 flex items-center justify-center mb-4">
					<KeyRound className="h-5 w-5 text-primary" />
				</div>
				<h2 className="text-lg font-semibold tracking-tight text-center mb-1">Set a new password</h2>
				<p className="text-sm text-muted-foreground text-center mb-4">
					Signed in as <span className="font-medium text-foreground">{user.email}</span>.
				</p>

				<form onSubmit={onSubmit} className="space-y-3">
					<div>
						<label htmlFor="password" className="text-sm font-medium block mb-1.5">
							New password
						</label>
						<input
							id="password"
							type="password"
							autoComplete="new-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={6}
							className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
						/>
					</div>

					<div>
						<label htmlFor="confirm" className="text-sm font-medium block mb-1.5">
							Confirm new password
						</label>
						<input
							id="confirm"
							type="password"
							autoComplete="new-password"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
							required
							minLength={6}
							className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
						/>
					</div>

					{state.kind === 'error' && (
						<div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
							<AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
							<span>{state.message}</span>
						</div>
					)}

					<Button type="submit" disabled={submitting} className="w-full">
						{submitting ? 'Updating…' : 'Update password'}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
