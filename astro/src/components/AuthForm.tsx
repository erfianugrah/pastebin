import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from './ui/button';

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

	// --- Signup success state ---
	if (mode === 'signup' && signupState.kind === 'awaiting_confirm') {
		const target = signupState.email;
		return (
			<div className="border border-primary bg-card animate-fade-in">
				<div className="border-b border-primary px-4 py-2 bg-card-alt">
					<h2 className="text-sm font-bold uppercase tracking-wide">✓ Check your email</h2>
				</div>
				<div className="px-4 py-3 space-y-3">
					<p className="text-sm">
						We sent a confirmation link to <span className="font-mono">{target}</span>.
						Click the link to finish creating your account — you&apos;ll be signed in automatically.
					</p>
					{resendInfo && (
						<div className="notice notice-success">
							<span className="text-xs">{resendInfo}</span>
						</div>
					)}
					<div className="flex flex-wrap gap-2">
						<Button onClick={() => onResend(target)} disabled={submitting}>
							{submitting ? 'Sending…' : "Didn't get it? Resend"}
						</Button>
						<Button
							variant="ghost"
							onClick={() => {
								setSignupState({ kind: 'form' });
								setResendInfo(null);
							}}
						>
							Wrong email? Try again
						</Button>
					</div>
				</div>
			</div>
		);
	}

	// --- Magic-link sent state ---
	if (mode === 'login' && loginState.kind === 'magic_sent') {
		const target = loginState.email;
		return (
			<div className="border border-primary bg-card animate-fade-in">
				<div className="border-b border-primary px-4 py-2 bg-card-alt">
					<h2 className="text-sm font-bold uppercase tracking-wide">✓ Check your email</h2>
				</div>
				<div className="px-4 py-3 space-y-3">
					<p className="text-sm">
						If an account exists for <span className="font-mono">{target}</span>, we&apos;ve sent a
						sign-in link. Click it to be signed in automatically.
					</p>
					<Button
						variant="ghost"
						onClick={() => {
							setLoginState({ kind: 'form' });
							setUseMagicLink(false);
						}}
					>
						← Back to sign-in
					</Button>
				</div>
			</div>
		);
	}

	// --- Form state ---
	const errorState = mode === 'login' ? loginState : signupState;
	const showResendInline =
		mode === 'login' && errorState.kind === 'error' && (errorState as { code?: string }).code === 'email_not_confirmed';

	return (
		<div className="border border-border bg-card animate-fade-in">
			<div className="border-b border-border-strong px-4 py-2 bg-card-alt">
				<h1 className="text-sm font-bold uppercase tracking-wide">
					{mode === 'login' ? 'Log in' : 'Create account'}
				</h1>
			</div>

			<div className="px-4 py-3 space-y-3">
				<a
					href="/api/auth/oauth/github"
					className="btn flex items-center justify-center gap-2 w-full h-8 border border-input bg-card text-foreground hover:bg-muted text-xs uppercase tracking-wide font-semibold no-underline"
				>
					Continue with GitHub
				</a>

				<div className="divider-label">
					or with email
				</div>

				<form onSubmit={onSubmit} className="space-y-3">
					<div>
						<label htmlFor="email" className="t-form-label">
							Email
						</label>
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

					{!(mode === 'login' && useMagicLink) && (
						<div>
							<div className="flex items-center justify-between mb-1">
								<label htmlFor="password" className="t-form-label !mb-0">
									Password
								</label>
								{mode === 'login' && (
									<a href="/forgot-password" className="text-[10px] uppercase tracking-wide text-link no-underline hover:underline">
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
								className="w-full h-7 border border-input bg-card px-2 text-xs font-mono"
							/>
						</div>
					)}

					{errorState.kind === 'error' && (
						<div className="notice notice-destructive">
							<span className="text-xs font-bold uppercase tracking-wide shrink-0">ERR</span>
							<span className="text-xs flex-1">{errorState.message}</span>
							{showResendInline && (
								<button
									type="button"
									onClick={() => onResend(email)}
									disabled={submitting}
									className="text-xs text-link underline ml-2"
								>
									{submitting ? 'Sending…' : 'Resend'}
								</button>
							)}
						</div>
					)}

					{resendInfo && (
						<div className="notice notice-success">
							<span className="text-xs">{resendInfo}</span>
						</div>
					)}

					<Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
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
							className="w-full text-xs uppercase tracking-wide text-link hover:underline"
						>
							{useMagicLink ? 'Use password instead' : 'Email me a sign-in link instead'}
						</button>
					)}

					<div className="text-center text-xs text-muted-foreground pt-1">
						{mode === 'login' ? (
							<>
								No account?{' '}
								<a href="/signup" className="text-link no-underline hover:underline">Sign up</a>
							</>
						) : (
							<>
								Already have an account?{' '}
								<a href="/login" className="text-link no-underline hover:underline">Log in</a>
							</>
						)}
					</div>
				</form>
			</div>
		</div>
	);
}
