import { useMemo, useState } from 'react';
import { toast } from './ui/toast';
import { cn } from '../lib/utils';

// ─── API snippets panel ─────────────────────────────────────────────
// Server-side this was three <pre set:text> blocks with no JS — now a
// React island so we can:
//   - Syntax-highlight per snippet via Prism (bash + javascript)
//   - Render a per-snippet Copy button in the header strip
//   - Add more snippets without inflating index.astro
//
// We use Prism.highlight() (the string API), NOT Prism.highlightElement(),
// because the global Prism toolbar / copy-to-clipboard plugins loaded in
// Layout.astro hook into highlightElement and auto-inject a <div class=
// "code-toolbar"> wrapper with its own copy button — that would stack on
// top of our header-strip Copy. The string API fires no plugin hooks.
//
// Grammars are imported here directly (not relied on the autoloader)
// because the autoloader is async — by the time it fetches `bash`, our
// synchronous render has already finished with plaintext fallback.

import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-javascript';

interface Snippet {
	title: string;
	language: 'bash' | 'javascript';
	code: string;
}

const SNIPPETS: Snippet[] = [
	{
		title: 'curl — create a paste',
		language: 'bash',
		code: `curl -X POST https://paste.erfi.io/pastes \\
  -H 'Content-Type: application/json' \\
  -d '{"content":"Hello world","expiration":86400}'`,
	},
	{
		title: 'curl — pipe a file',
		language: 'bash',
		code: `cat file.py | jq -Rs '{"content":.,"language":"python"}' | \\
  curl -X POST https://paste.erfi.io/pastes \\
  -H 'Content-Type: application/json' -d @-`,
	},
	{
		title: 'fetch — JavaScript',
		language: 'javascript',
		code: `const res = await fetch('https://paste.erfi.io/pastes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    content: 'Hello world',
    language: 'javascript',
    expiration: 86400,
  }),
});
const { url } = await res.json();
console.log(url);`,
	},
];

export default function ApiSnippets() {
	return (
		<div className="border border-border bg-card">
			{SNIPPETS.map((s, i) => (
				<SnippetBlock key={s.title} snippet={s} first={i === 0} />
			))}
		</div>
	);
}

function SnippetBlock({ snippet, first }: { snippet: Snippet; first: boolean }) {
	const [copied, setCopied] = useState(false);

	// Highlighted HTML — computed once per (code, language). Falls back to
	// the raw code if the grammar isn't loaded yet (defensive; the static
	// imports above guarantee it is).
	const highlighted = useMemo(() => {
		const grammar = Prism.languages[snippet.language];
		if (!grammar) return escapeHtml(snippet.code);
		return Prism.highlight(snippet.code, grammar, snippet.language);
	}, [snippet.code, snippet.language]);

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(snippet.code);
			setCopied(true);
			toast({ message: `${snippet.title} copied`, type: 'success', duration: 1500 });
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast({ message: 'Failed to copy.', type: 'error', duration: 2500 });
		}
	}

	return (
		<>
			<div
				className={cn(
					'flex items-stretch border-b border-border bg-card-alt',
					!first && 'border-t border-border-strong',
				)}
			>
				<span className="flex-1 px-3 py-1 text-[10px] uppercase tracking-wide font-semibold">
					{snippet.title}
				</span>
				<button
					type="button"
					onClick={handleCopy}
					aria-label={`Copy ${snippet.title}`}
					className={cn(
						'btn px-2 border-l border-border text-[10px] uppercase tracking-wide font-semibold',
						copied
							? 'bg-success text-success-foreground border-success'
							: 'text-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary',
					)}
				>
					{copied ? '✓ Copied' : 'Copy'}
				</button>
			</div>
			<pre className="overflow-x-auto p-3 text-xs font-mono bg-card !rounded-none !border-0 !m-0">
				<code
					className={`language-${snippet.language}`}
					dangerouslySetInnerHTML={{ __html: highlighted }}
				/>
			</pre>
		</>
	);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
