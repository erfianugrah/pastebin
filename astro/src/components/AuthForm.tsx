import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Mail, KeyRound, Github } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

interface Props {
	mode: 'login' | 'signup';
}

type LoginState =
	| { kind: 'form' }
	| { kind: 'error'; code?: string; message: string }
	| { kind: 'magic_sent'; email: string };

type SignupState =
	| { kind: 'form' }
	| { kind: 'error'; code?: string; message: string }
	| { kind: 'awaiting_confirm'; email: string };

export default function AuthForm({ mode }: Props) {
	const { signIn, signUp, resendConfirmation, signInWithMagicLink } = useAuth();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [loginState, setLoginState] = useState<LoginState>({ kind: 'form' });
	const [signupState, setSignupState] = useState<SignupState>({ kind: 'form' });
	const [resendInfo, setResendInfo] = useState<string | null>(null);
	// Login can swap into a passwordless (magic link) form mode.
	const [useMagicLink, setUseMagicLink] = useState(false);

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		setLoginState({ kind: 'form' });
		setSignupState({ kind: 'form' });
		setResendInfo(null);

		if (!email) {
			(mode === 'login' ? setLoginState : setSignupState)({
				kind: 'error',
				message: 'Email is required',
			});
			return;
		}

		// Magic-link path: skip password validation entirely.
		if (mode === 'login' && useMagicLink) {
			setSubmitting(true);
			try {
				const { error } = await signInWithMagicLink(email);
				if (error) {
					setLoginState({ kind: 'error', message: error.message });
				} else {
					setLoginState({ kind: 'magic_sent', email });
				}
			} finally {
				setSubmitting(false);
			}
			return;
		}

		if (!password) {
			(mode === 'login' ? setLoginState : setSignupState)({
				kind: 'error',
				message: 'Password is required',
			});
			return;
		}
		if (password.length < 6) {
			(mode === 'login' ? setLoginState : setSignupState)({
				kind: 'error',
				message: 'Password must be at least 6 characters',
			});
			return;
		}

		setSubmitting(true);
		try {
			if (mode === 'login') {
				const { error } = await signIn(email, password);
				if (error) {
					setLoginState({ kind: 'error', code: error.code, message: error.message });
				} else {
					window.location.href = '/my';
				}
			} else {
				const { error, needsConfirm } = await signUp(email, password);
				if (error) {
					setSignupState({ kind: 'error', code: error.code, message: error.message });
				} else if (needsConfirm) {
					setSignupState({ kind: 'awaiting_confirm', email });
				} else {
					window.location.href = '/my';
				}
			}
		} finally {
			setSubmitting(false);
		}
	}

	async function onResend(targetEmail: string) {
		setResendInfo(null);
		setSubmitting(true);
		try {
			await resendConfirmation(targetEmail);
			setResendInfo(`Sent another confirmation email to ${targetEmail}.`);
		} finally {
			setSubmitting(false);
		}
	}

	// --- Signup success state: replace the form entirely ---
	if (mode === 'signup' && signupState.kind === 'awaiting_confirm') {
		const target = signupState.email;
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
						We sent a confirmation link to <span className="font-medium text-foreground">{target}</span>.
						Click the link to finish creating your account — you&apos;ll be signed in automatically.
					</p>
					{resendInfo && (
						<div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm mb-3">
							<CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
							<span>{resendInfo}</span>
						</div>
					)}
					<div className="flex flex-col gap-2">
						<Button
							variant="outline"
							onClick={() => onResend(target)}
							disabled={submitting}
							className="w-full"
						>
							{submitting ? 'Sending…' : "Didn't get it? Resend"}
						</Button>
						<Button
							variant="ghost"
							onClick={() => {
								setSignupState({ kind: 'form' });
								setResendInfo(null);
							}}
							className="w-full"
						>
							Wrong email? Try again
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	// --- Magic-link sent state ---
	if (mode === 'login' && loginState.kind === 'magic_sent') {
		const target = loginState.email;
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
						If an account exists for <span className="font-medium text-foreground">{target}</span>,
						we&apos;ve sent a sign-in link. Click it to be signed in automatically.
					</p>
					<Button
						variant="ghost"
						onClick={() => {
							setLoginState({ kind: 'form' });
							setUseMagicLink(false);
						}}
						className="w-full"
					>
						Back to sign-in
					</Button>
				</CardContent>
			</Card>
		);
	}

	// --- Form state for both login and signup ---
	const errorState = mode === 'login' ? loginState : signupState;
	const showResendInline =
		mode === 'login' && errorState.kind === 'error' && (errorState as { code?: string }).code === 'email_not_confirmed';

	return (
		<Card>
			<CardContent className="p-6">
				<h2 className="text-lg font-semibold tracking-tight mb-1">
					{mode === 'login' ? 'Log in' : 'Create an account'}
				</h2>
				<p className="text-sm text-muted-foreground mb-4">
					{mode === 'login'
						? useMagicLink
							? "Enter your email and we'll send you a sign-in link."
							: 'Sign in to see your saved pastes.'
						: 'Sign up to keep your pastes in one place.'}
				</p>

				<a
					href="/api/auth/oauth/github"
					className="flex items-center justify-center gap-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
				>
					<Github className="h-4 w-4" />
					Continue with GitHub
				</a>

				<div className="flex items-center gap-3 my-4">
					<div className="h-px flex-1 bg-border" />
					<span className="text-xs text-muted-foreground">or with email</span>
					<div className="h-px flex-1 bg-border" />
				</div>

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

					{!(mode === 'login' && useMagicLink) && (
						<div>
							<div className="flex items-center justify-between mb-1.5">
								<label htmlFor="password" className="text-sm font-medium">
									Password
								</label>
								{mode === 'login' && (
									<a href="/forgot-password" className="text-xs text-muted-foreground hover:text-primary hover:underline">
										Forgot?
									</a>
								)}
							</div>
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
					)}

					{errorState.kind === 'error' && (
						<div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
							<div className="flex items-start gap-2">
								<AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
								<span>{errorState.message}</span>
							</div>
							{showResendInline && (
								<div className="mt-2 pl-6">
									<button
										type="button"
										onClick={() => onResend(email)}
										disabled={submitting}
										className="text-xs underline text-destructive/80 hover:text-destructive"
									>
										{submitting ? 'Sending…' : 'Resend confirmation email'}
									</button>
								</div>
							)}
						</div>
					)}

					{resendInfo && (
						<div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
							<CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
							<span>{resendInfo}</span>
						</div>
					)}

					<Button type="submit" disabled={submitting} className="w-full">
						{submitting
							? 'Working…'
							: mode === 'login'
								? useMagicLink
									? 'Send sign-in link'
									: 'Sign in'
								: 'Sign up'}
					</Button>

					{mode === 'login' && (
						<button
							type="button"
							onClick={() => {
								setUseMagicLink((v) => !v);
								setLoginState({ kind: 'form' });
							}}
							className="w-full flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-primary py-1"
						>
							{useMagicLink ? (
								<>
									<KeyRound className="h-3.5 w-3.5" />
									Use password instead
								</>
							) : (
								<>
									<Mail className="h-3.5 w-3.5" />
									Email me a sign-in link instead
								</>
							)}
						</button>
					)}

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
