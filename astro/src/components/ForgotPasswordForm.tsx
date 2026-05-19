import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';

type State =
	| { kind: 'form' }
	| { kind: 'error'; message: string }
	| { kind: 'sent'; email: string };

export default function ForgotPasswordForm() {
	const { forgotPassword } = useAuth();
	const [email, setEmail] = useState('');
	const [state, setState] = useState<State>({ kind: 'form' });
	const [submitting, setSubmitting] = useState(false);

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		if (!email) {
			setState({ kind: 'error', message: 'Email is required' });
			return;
		}
		setSubmitting(true);
		try {
			const { error } = await forgotPassword(email);
			if (error) {
				setState({ kind: 'error', message: error.message });
			} else {
				setState({ kind: 'sent', email });
			}
		} finally {
			setSubmitting(false);
		}
	}

	if (state.kind === 'sent') {
		return (
			<div className="border border-primary bg-card animate-fade-in">
				<div className="border-b border-primary px-4 py-2 bg-card-alt">
					<h2 className="text-sm font-bold uppercase tracking-wide">✓ Check your email</h2>
				</div>
				<div className="px-4 py-3 space-y-3">
					<p className="text-sm">
						If an account exists for <span className="font-mono">{state.email}</span>, we&apos;ve sent
						a password reset link. Click it to choose a new password.
					</p>
					<Button variant="ghost" onClick={() => setState({ kind: 'form' })}>
						Wrong email? Try again
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="border border-border bg-card animate-fade-in">
			<div className="border-b border-border-strong px-4 py-2 bg-card-alt">
				<h1 className="text-sm font-bold uppercase tracking-wide">Forgot password</h1>
			</div>
			<div className="px-4 py-3">
				<p className="text-sm text-muted-foreground mb-3">
					Enter your email and we&apos;ll send you a link to set a new one.
				</p>

				<form onSubmit={onSubmit} className="space-y-3">
					<div>
						<label htmlFor="email" className="t-form-label">Email</label>
						<input
							id="email"
							type="email"
							autoComplete="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
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
						{submitting ? 'Sending…' : 'Send reset link'}
					</Button>

					<div className="text-center text-xs text-muted-foreground pt-1">
						Remembered it?{' '}
						<a href="/login" className="text-link no-underline hover:underline">Log in</a>
					</div>
				</form>
			</div>
		</div>
	);
}
