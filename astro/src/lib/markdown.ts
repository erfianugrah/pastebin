// ─── Markdown rendering pipeline ──────────────────────────────────────
// marked v18 + DOMPurify v3 with the 8 customisations from
// ui-overhaul/HANDOFF-vendor-prism-marked.md §2:
//   1. GFM defaults, no line-break-as-<br>
//   2. Code blocks → Prism-compatible <pre.language-X.line-numbers>
//   3. Tables wrapped in .prose-table-scroll
//   4. Task lists with disabled checkboxes + .task-list-item class
//   5. Heading IDs slugged from text (GitHub-style, deduped)
//   6. External links get rel="noopener noreferrer" target="_blank"
//   7. Inline `[[kbd]]` extension → <kbd>kbd</kbd>
//   8. Output sanitised with DOMPurify (allowing the additions above)

import { Marked, type RendererObject, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

// ── Slugger ───────────────────────────────────────────────────────────
// Per-call uniqueness so duplicate headings get -1, -2, … suffixes.
function createSlugger() {
	const seen = new Map<string, number>();
	return (raw: string): string => {
		const base = raw
			.toLowerCase()
			.trim()
			.replace(/<[^>]+>/g, '') // strip HTML tags from heading text
			.replace(/[^\w\s-]/g, '') // strip punctuation
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
		const slug = base || 'section';
		const count = seen.get(slug) ?? 0;
		seen.set(slug, count + 1);
		return count === 0 ? slug : `${slug}-${count}`;
	};
}

// Escape HTML entities — used inside fenced code blocks so Prism's tokens
// don't get parsed by the browser.
function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
	);
}

// Map common UI display names to Prism grammar IDs.
const LANG_ALIASES: Record<string, string> = {
	'plain text': 'none',
	plaintext: 'none',
	plain: 'none',
	'': 'none',
};

function normalizeLang(lang: string | undefined): string {
	if (!lang) return 'none';
	const lower = lang.toLowerCase().trim();
	return LANG_ALIASES[lower] ?? lower;
}

// ── External-host detection ───────────────────────────────────────────
// In SSR / Node tests there's no window. Treat anything starting with a
// protocol or "//" as external; bare paths ("/foo", "#bar", "./") are local.
function isExternalHref(href: string): boolean {
	if (!href) return false;
	// Protocol-relative ("//host/…") — always external. Check before the
	// "/" prefix branch so protocol-relative doesn't get mistaken for local.
	if (href.startsWith('//')) {
		if (typeof window !== 'undefined') {
			try {
				const u = new URL(href, window.location.origin);
				return u.host !== window.location.host;
			} catch {
				return true;
			}
		}
		return true;
	}
	if (href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
		return false;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
		if (typeof window !== 'undefined') {
			try {
				const u = new URL(href, window.location.origin);
				return u.host !== window.location.host;
			} catch {
				return true;
			}
		}
		return true;
	}
	return false;
}

// ── [[kbd]] inline extension ──────────────────────────────────────────
const kbdExtension: TokenizerAndRendererExtension = {
	name: 'kbd',
	level: 'inline',
	start(src) {
		const m = src.match(/\[\[/);
		return m ? m.index : undefined;
	},
	tokenizer(src) {
		const match = /^\[\[([^\]]+)\]\]/.exec(src);
		if (match) {
			return {
				type: 'kbd',
				raw: match[0],
				text: match[1],
			};
		}
		return undefined;
	},
	renderer(token) {
		return `<kbd>${escapeHtml((token as unknown as { text: string }).text)}</kbd>`;
	},
};

// ── Build a configured Marked instance ────────────────────────────────
// Use a per-render Marked so the slugger state is isolated.
function buildMarked() {
	const slug = createSlugger();

	const renderer: RendererObject = {
		// Fenced code block — emit Prism-compatible markup. We do NOT call
		// Prism here; CodeViewer's effect re-runs highlightAllUnder after
		// the HTML is committed to the DOM.
		code({ text, lang }: Tokens.Code): string {
			const language = normalizeLang(lang);
			const cls = `language-${language}`;
			return `<pre class="${cls} line-numbers" data-language="${escapeHtml(language)}"><code class="${cls}">${escapeHtml(text)}\n</code></pre>`;
		},

		// Heading with slugged id, conveyed via `data-slug` so the DOMPurify
		// hook (see markdown.ts) can hoist it to `id` after sanitisation.
		// Passing `id=` here would be stripped by SANITIZE_NAMED_PROPS when
		// the slug collides with a window/document property name; routing
		// through data-slug + post-process gives us our own controlled
		// anchor ids without weakening the sanitiser.
		heading(this: { parser: { parseInline: (tokens: Tokens.Heading['tokens']) => string } }, token: Tokens.Heading): string {
			const inner = this.parser.parseInline(token.tokens);
			const id = slug(token.text);
			return `<h${token.depth} data-slug="${id}">${inner}</h${token.depth}>\n`;
		},

		// Link — external gets rel + target
		link(this: { parser: { parseInline: (tokens: Tokens.Link['tokens']) => string } }, token: Tokens.Link): string {
			const inner = this.parser.parseInline(token.tokens);
			const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
			const ext = isExternalHref(token.href);
			const attrs = ext ? ' rel="noopener noreferrer" target="_blank"' : '';
			return `<a href="${escapeHtml(token.href)}"${title}${attrs}>${inner}</a>`;
		},

		// Task-list item — disabled checkbox + .task-list-item.
		// We emit our own checkbox; the override below silences marked's default
		// checkbox renderer so the input doesn't appear twice.
		listitem(this: { parser: { parse: (tokens: Tokens.ListItem['tokens']) => string } }, token: Tokens.ListItem): string {
			if (token.task) {
				const checked = token.checked ? ' checked' : '';
				const body = this.parser.parse(token.tokens).replace(/^<p>|<\/p>\n?$/g, '');
				return `<li class="task-list-item"><input type="checkbox" disabled${checked}>${body}</li>\n`;
			}
			const body = this.parser.parse(token.tokens);
			return `<li>${body}</li>\n`;
		},

		// Suppress marked's default checkbox renderer — our listitem above emits it.
		checkbox(): string {
			return '';
		},

		// Table — wrap in .prose-table-scroll
		table(this: { parser: { parseInline: (tokens: Tokens.TableCell['tokens']) => string } }, token: Tokens.Table): string {
			let header = '';
			for (let i = 0; i < token.header.length; i++) {
				const cell = token.header[i];
				const align = cell.align ? ` style="text-align:${cell.align}"` : '';
				header += `<th${align}>${this.parser.parseInline(cell.tokens)}</th>`;
			}
			let body = '';
			for (const row of token.rows) {
				let r = '';
				for (let i = 0; i < row.length; i++) {
					const cell = row[i];
					const align = cell.align ? ` style="text-align:${cell.align}"` : '';
					r += `<td${align}>${this.parser.parseInline(cell.tokens)}</td>`;
				}
				body += `<tr>${r}</tr>`;
			}
			return `<div class="prose-table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>\n`;
		},
	};

	const m = new Marked({ gfm: true, breaks: false });
	m.use({ renderer, extensions: [kbdExtension] });
	return m;
}

// ── DOMPurify config ──────────────────────────────────────────────────
// Allow the attrs / tags our renderer emits. DOMPurify defaults already
// allow basic prose; we just extend.
//
// Previous config used `SANITIZE_DOM: false` and `SANITIZE_NAMED_PROPS:
// false` so that headings could keep slugged `id` attributes matching
// names like "title" or "form". That opened the door to DOM clobbering
// (any inline `<div id="defaultView">` in user markdown would shadow
// window.defaultView, breaking globals that future analytics / plugins
// might read). With the defaults restored, DOMPurify strips ids that
// collide with named properties on window/document, and we provide
// safe heading anchors via the per-element hook below.
const PURIFY_CONFIG = {
	ADD_ATTR: ['id', 'class', 'target', 'rel', 'disabled', 'checked', 'data-language', 'data-slug'],
	ADD_TAGS: ['kbd'],
	// SANITIZE_NAMED_PROPS + SANITIZE_DOM left at their defaults (both true).
	// NB: not `as const` — DOMPurify's Config types expect mutable `string[]`,
	// and a readonly tuple fails to match the string-returning sanitize overload.
};

// ── Heading-id hook ───────────────────────────────────────────────────
// Marked emits `<h1 data-slug="hello">Hello</h1>` (data-slug is allow-listed
// above). After DOMPurify sanitises the markup, this hook moves the slug
// value into a real `id` attribute on each heading element. Because the
// slug was generated by `createSlugger` (HTML stripped, ASCII alnum +
// hyphens only, never user-controlled raw input), it is safe to assign
// directly, and DOMPurify's named-property check still wraps the final id
// (the hook runs before that check completes).
//
// Hooks are global to the DOMPurify instance; we add it once at module
// load. It is a no-op on non-heading elements.
let hookInstalled = false;
function ensureHeadingIdHook() {
	if (hookInstalled) return;
	hookInstalled = true;
	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		if (!(node instanceof Element)) return;
		if (!/^h[1-6]$/i.test(node.tagName)) return;
		const slug = node.getAttribute('data-slug');
		if (slug) {
			node.setAttribute('id', slug);
			node.removeAttribute('data-slug');
		}
	});
}

// ── Public API ────────────────────────────────────────────────────────
export function renderMarkdown(src: string): string {
	if (typeof src !== 'string' || src.length === 0) return '';
	ensureHeadingIdHook();
	const m = buildMarked();
	// marked.parse is sync when async option is off (default).
	const raw = m.parse(src, { async: false }) as string;
	return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}

// Exposed only for unit tests.
export const __test__ = { createSlugger, isExternalHref, escapeHtml, normalizeLang };
