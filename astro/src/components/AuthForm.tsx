import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { AUTH_ENABLED } from '../lib/supabase';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

interface Props {
	mode: 'login' | 'signup';
}

export default function AuthForm({ mode }: Props) {
	const { signIn, signUp } = useAuth();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	if (!AUTH_ENABLED) {
		return (
			<Card>
				<CardContent className="p-6 text-sm text-muted-foreground">
					Authentication is not configured for this deployment.
				</CardContent>
			</Card>
		);
	}

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setInfo(null);
		if (!email || !password) {
			setError('Email and password are required');
			return;
		}
		if (password.length < 6) {
			setError('Password must be at least 6 characters');
			return;
		}

		setSubmitting(true);
		try {
			if (mode === 'login') {
				const { error } = await signIn(email, password);
				if (error) {
					setError(error.message);
				} else {
					window.location.href = '/my';
				}
			} else {
				const { error, needsConfirm } = await signUp(email, password);
				if (error) {
					setError(error.message);
				} else if (needsConfirm) {
					setInfo(
						`Check your email at ${email} for a confirmation link before signing in.`,
					);
				} else {
					window.location.href = '/my';
				}
			}
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Card>
			<CardContent className="p-6">
				<h2 className="text-lg font-semibold tracking-tight mb-1">
					{mode === 'login' ? 'Log in' : 'Create an account'}
				</h2>
				<p className="text-sm text-muted-foreground mb-4">
					{mode === 'login'
						? 'Sign in to see your saved pastes.'
						: 'Sign up to keep your pastes in one place.'}
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

					<div>
						<label htmlFor="password" className="text-sm font-medium block mb-1.5">
							Password
						</label>
						<input
							id="password"
							type="password"
							autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							minLength={6}
							className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
						/>
					</div>

					{error && (
						<div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
							<AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
							<span>{error}</span>
						</div>
					)}

					{info && (
						<div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
							<CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
							<span>{info}</span>
						</div>
					)}

					<Button type="submit" disabled={submitting} className="w-full">
						{submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Sign up'}
					</Button>

					<div className="text-center text-sm text-muted-foreground pt-2">
						{mode === 'login' ? (
							<>
								No account?{' '}
								<a href="/signup" className="text-primary hover:underline">
									Sign up
								</a>
							</>
						) : (
							<>
								Already have an account?{' '}
								<a href="/login" className="text-primary hover:underline">
									Log in
								</a>
							</>
						)}
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
