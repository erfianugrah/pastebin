// @vitest-environment jsdom
// markdown.ts unit tests — exercises every custom renderer + DOMPurify config.
import { describe, it, expect } from 'vitest';
import { renderMarkdown, __test__ } from '../markdown';

const { createSlugger, isExternalHref, normalizeLang, escapeHtml } = __test__;

describe('createSlugger', () => {
	it('produces github-style slugs', () => {
		const slug = createSlugger();
		expect(slug('Hello World')).toBe('hello-world');
		expect(slug('Tabs vs. Spaces')).toBe('tabs-vs-spaces');
		expect(slug('A — B — C')).toBe('a-b-c');
	});

	it('dedupes duplicates with -N suffix', () => {
		const slug = createSlugger();
		expect(slug('Notes')).toBe('notes');
		expect(slug('Notes')).toBe('notes-1');
		expect(slug('Notes')).toBe('notes-2');
	});

	it('falls back to "section" for empty input', () => {
		expect(createSlugger()('!!!')).toBe('section');
		expect(createSlugger()('')).toBe('section');
	});
});

describe('isExternalHref', () => {
	it('treats bare paths and anchors as local', () => {
		expect(isExternalHref('/foo')).toBe(false);
		expect(isExternalHref('#bar')).toBe(false);
		expect(isExternalHref('./x.md')).toBe(false);
		expect(isExternalHref('../y')).toBe(false);
		expect(isExternalHref('')).toBe(false);
	});

	it('treats absolute URLs as external', () => {
		expect(isExternalHref('https://example.com/x')).toBe(true);
		expect(isExternalHref('//cdn.example.com/a')).toBe(true);
		expect(isExternalHref('mailto:foo@bar.com')).toBe(true);
	});
});

describe('normalizeLang', () => {
	it('aliases plain-text variants to "none"', () => {
		expect(normalizeLang('Plain Text')).toBe('none');
		expect(normalizeLang('plaintext')).toBe('none');
		expect(normalizeLang(undefined)).toBe('none');
		expect(normalizeLang('')).toBe('none');
	});

	it('lowercases known langs', () => {
		expect(normalizeLang('TypeScript')).toBe('typescript');
		expect(normalizeLang('Python')).toBe('python');
	});
});

describe('escapeHtml', () => {
	it('escapes the five entities', () => {
		expect(escapeHtml('<script>"&\'</script>')).toBe('&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
	});
});

describe('renderMarkdown — headings', () => {
	it('emits an id slugged from the heading text', () => {
		const html = renderMarkdown('# Hello World\n## Sub Section');
		expect(html).toContain('<h1 id="hello-world">');
		expect(html).toContain('<h2 id="sub-section">');
	});

	it('dedupes duplicate heading slugs within a single render', () => {
		const html = renderMarkdown('# Notes\n# Notes\n# Notes');
		expect(html).toContain('<h1 id="notes">');
		expect(html).toContain('<h1 id="notes-1">');
		expect(html).toContain('<h1 id="notes-2">');
	});
});

describe('renderMarkdown — links', () => {
	it('adds rel + target on external links', () => {
		const html = renderMarkdown('[ext](https://example.com)');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('target="_blank"');
	});

	it('does not add rel/target on local links', () => {
		const html = renderMarkdown('[local](/foo)');
		expect(html).toContain('href="/foo"');
		expect(html).not.toContain('rel="noopener');
		expect(html).not.toContain('target="_blank"');
	});

	it('does not add rel/target on anchor links', () => {
		const html = renderMarkdown('[anchor](#bar)');
		expect(html).toContain('href="#bar"');
		expect(html).not.toContain('rel="noopener');
	});
});

describe('renderMarkdown — fenced code blocks', () => {
	it('emits Prism-compatible markup for a typed fence', () => {
		const html = renderMarkdown('```ts\nconst x: number = 1;\n```');
		expect(html).toContain('<pre class="language-ts line-numbers" data-language="ts">');
		expect(html).toContain('<code class="language-ts">');
	});

	it('falls back to language-none for untyped fences', () => {
		const html = renderMarkdown('```\nplain\n```');
		expect(html).toContain('<pre class="language-none line-numbers"');
	});

	it('escapes HTML inside code blocks', () => {
		const html = renderMarkdown('```html\n<script>alert(1)</script>\n```');
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
	});
});

describe('renderMarkdown — tables', () => {
	it('wraps GFM tables in .prose-table-scroll', () => {
		const md = '| a | b |\n| - | - |\n| 1 | 2 |';
		const html = renderMarkdown(md);
		expect(html).toContain('<div class="prose-table-scroll">');
		expect(html).toContain('<table>');
		expect(html).toContain('<th>a</th>');
		expect(html).toContain('<td>1</td>');
	});
});

describe('renderMarkdown — task lists', () => {
	it('emits li.task-list-item with disabled checkbox', () => {
		const html = renderMarkdown('- [ ] todo\n- [x] done');
		expect(html).toContain('<li class="task-list-item"><input type="checkbox" disabled');
		expect(html).toContain('checked');
		expect(html).toContain('todo');
		expect(html).toContain('done');
	});
});

describe('renderMarkdown — kbd extension', () => {
	it('renders [[Ctrl]] as <kbd>Ctrl</kbd>', () => {
		const html = renderMarkdown('Press [[Ctrl]]+[[Enter]] to submit');
		expect(html).toContain('<kbd>Ctrl</kbd>');
		expect(html).toContain('<kbd>Enter</kbd>');
	});
});

describe('renderMarkdown — DOMPurify sanitization', () => {
	it('strips <script> tags from raw HTML', () => {
		const html = renderMarkdown('<script>alert(1)</script>\n\nbody');
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('alert(1)');
	});

	it('strips onerror handlers but preserves the element', () => {
		const html = renderMarkdown('<img src="/a.png" onerror="alert(1)">');
		expect(html).not.toContain('onerror');
	});

	it('preserves task-list-item class on <li>', () => {
		const html = renderMarkdown('- [ ] keep me');
		expect(html).toMatch(/class="task-list-item"/);
	});

	it('preserves heading ids', () => {
		const html = renderMarkdown('# Hello');
		expect(html).toMatch(/<h1 id="hello"/);
	});

	// [B4] DOM-clobbering regression: previously SANITIZE_DOM/SANITIZE_NAMED_PROPS
	// were both disabled so user markdown could `<div id="defaultView">…</div>`
	// and shadow window.defaultView. Hook-driven heading anchors keep working
	// without that hole.
	it('strips inline id attributes that shadow window globals', () => {
		const html = renderMarkdown('<div id="defaultView">attacker</div>');
		expect(html).not.toContain('id="defaultView"');
	});

	it('strips inline name attributes that could clobber the DOM', () => {
		const html = renderMarkdown('<form name="body"><input name="cookie"></form>');
		expect(html).not.toMatch(/name="body"/);
		expect(html).not.toMatch(/name="cookie"/);
	});

	// DOMPurify's SANITIZE_NAMED_PROPS specifically targets the DOM-named-
	// property attack surface — ids/names that resolve to window/document
	// properties via the named-access mechanism. Not every "global JS name"
	// (e.g. `alert`) is in that set; this test covers the canonical ones.
	it('strips id values that match document named properties', () => {
		const html = renderMarkdown(
			'<div id="defaultView">x</div>\n\n<div id="body">y</div>\n\n<div id="forms">z</div>',
		);
		expect(html).not.toContain('id="defaultView"');
		expect(html).not.toContain('id="body"');
		expect(html).not.toContain('id="forms"');
	});

	// [I12] / regression: `javascript:` URLs in markdown links must be neutralised.
	// DOMPurify's default `ALLOWED_URI_REGEXP` is what enforces this; pin the
	// behaviour with a test so future config changes can't silently weaken it.
	it('blocks javascript: hrefs in links', () => {
		const html = renderMarkdown('[click](javascript:alert(1))');
		expect(html).not.toMatch(/href="javascript:/i);
	});
});

describe('renderMarkdown — input handling', () => {
	it('returns empty string for empty input', () => {
		expect(renderMarkdown('')).toBe('');
	});

	it('handles plain paragraphs', () => {
		const html = renderMarkdown('Hello world');
		expect(html).toContain('<p>Hello world</p>');
	});
});
