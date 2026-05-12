import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Mail } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

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
			<Card>
				<CardContent className="p-6">
					<div className="mx-auto rounded-full w-12 h-12 bg-primary/10 flex items-center justify-center mb-4">
						<Mail className="h-5 w-5 text-primary" />
					</div>
					<h2 className="text-lg font-semibold tracking-tight text-center mb-2">
						Check your email
					</h2>
					<p className="text-sm text-muted-foreground text-center mb-6">
						If an account exists for <span className="font-medium text-foreground">{state.email}</span>,
						we&apos;ve sent a password reset link. Click the link to choose a new password.
					</p>
					<div className="flex flex-col gap-2">
						<Button
							variant="ghost"
							onClick={() => setState({ kind: 'form' })}
							className="w-full"
						>
							Wrong email? Try again
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardContent className="p-6">
				<h2 className="text-lg font-semibold tracking-tight mb-1">Forgot your password?</h2>
				<p className="text-sm text-muted-foreground mb-4">
					Enter your email and we&apos;ll send you a link to set a new one.
				</p>

				<form onSubmit={onSubmit} className="space-y-3">
					<div>
						<label htmlFor="email" className="text-sm font-medium block mb-1.5">
							Email
						</label>
						<input
							id="email"
							type="email"
							autoComplete="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
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
						{submitting ? 'Sending…' : 'Send reset link'}
					</Button>

					<div className="text-center text-sm text-muted-foreground pt-2">
						Remembered it?{' '}
						<a href="/login" className="text-primary hover:underline">
							Log in
						</a>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
