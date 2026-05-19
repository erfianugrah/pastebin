import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';

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

	if (loading) {
		return <p className="text-xs text-muted-foreground">Loading…</p>;
	}

	if (!user) {
		return (
			<div className="border border-warning bg-card animate-fade-in">
				<div className="border-b border-warning px-4 py-2 bg-card-alt">
					<h1 className="text-sm font-bold uppercase tracking-wide text-warning">⚠ Session needed</h1>
				</div>
				<div className="px-4 py-3 space-y-3">
					<p className="text-sm">
						To set a new password, click the link in the password-reset email we sent you. Links
						expire after a short time — request a new one if needed.
					</p>
					<Button variant="primary" asChild className="w-full">
						<a href="/forgot-password" className="no-underline">Request a reset link →</a>
					</Button>
				</div>
			</div>
		);
	}

	if (state.kind === 'done') {
		return (
			<div className="border border-primary bg-card animate-fade-in">
				<div className="border-b border-primary px-4 py-2 bg-card-alt">
					<h2 className="text-sm font-bold uppercase tracking-wide">✓ Password updated</h2>
				</div>
				<div className="px-4 py-3 space-y-3">
					<p className="text-sm">You can continue using your account with the new password.</p>
					<Button variant="primary" asChild className="w-full">
						<a href="/my" className="no-underline">Go to my pastes →</a>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="border border-border bg-card animate-fade-in">
			<div className="border-b border-border-strong px-4 py-2 bg-card-alt">
				<h1 className="text-sm font-bold uppercase tracking-wide">Set new password</h1>
			</div>
			<div className="px-4 py-3">
				<p className="text-xs text-muted-foreground mb-3">
					Signed in as <span className="font-mono text-foreground">{user.email}</span>.
				</p>

				<form onSubmit={onSubmit} className="space-y-3">
					<div>
						<label htmlFor="password" className="t-form-label">New password</label>
						<input
							id="password"
							type="password"
							autoComplete="new-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={6}
							className="w-full h-7 border border-input bg-card px-2 text-xs font-mono"
						/>
					</div>

					<div>
						<label htmlFor="confirm" className="t-form-label">Confirm new password</label>
						<input
							id="confirm"
							type="password"
							autoComplete="new-password"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
							required
							minLength={6}
							className="w-full h-7 border border-input bg-card px-2 text-xs font-mono"
						/>
					</div>

					{state.kind === 'error' && (
						<div className="notice notice-destructive">
							<span className="text-xs font-bold uppercase tracking-wide shrink-0">ERR</span>
							<span className="text-xs">{state.message}</span>
						</div>
					)}

					<Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
						{submitting ? 'Updating…' : 'Update password'}
					</Button>
				</form>
			</div>
		</div>
	);
}
