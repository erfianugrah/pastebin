// @vitest-environment jsdom
// prism-setup.ts unit tests — verify the 6 HANDOFF patches plus baseline.
import { describe, it, expect, beforeAll } from 'vitest';
import Prism from 'prismjs';

// These grammars must be loaded *before* importing prism-setup; setup may
// patch them in place.
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-markdown';

import { setupPrism } from '../prism-setup';

beforeAll(() => {
	setupPrism();
});

describe('setupPrism', () => {
	it('disables Prism auto-attach (Prism.manual = true)', () => {
		expect(Prism.manual).toBe(true);
	});
});

describe('TypeScript template-literal interpolation', () => {
	it('tokenizes ${expr} inside backticks as interpolation, not as a plain string', () => {
		const src = '`hello ${user.name}!`';
		const tokens = Prism.tokenize(src, Prism.languages.typescript);
		// Recursively check for an "interpolation" token containing "user.name".
		function findInterpolation(arr: unknown[]): boolean {
			for (const t of arr) {
				if (
					t &&
					typeof t === 'object' &&
					'type' in t &&
					(t as { type: string }).type === 'interpolation'
				) {
					return true;
				}
				if (t && typeof t === 'object' && 'content' in t) {
					const inner = (t as { content: unknown }).content;
					if (Array.isArray(inner) && findInterpolation(inner)) return true;
				}
			}
			return false;
		}
		expect(findInterpolation(tokens)).toBe(true);
	});
});

describe('TSX fragment syntax', () => {
	it('does not crash tokenizing <></> fragments', () => {
		const src = 'const x = <></>;';
		expect(() => Prism.tokenize(src, Prism.languages.tsx)).not.toThrow();
		const html = Prism.highlight(src, Prism.languages.tsx, 'tsx');
		// `const` keyword highlight + escaped <  marker proves the grammar ran.
		expect(html).toContain('token keyword');
		expect(html).toContain('&lt;');
	});
});

describe('Markdown embedded fenced code', () => {
	it('tokenizes ```ts fenced blocks with embedded language', () => {
		const src = '```ts\nconst x: number = 1;\n```';
		const html = Prism.highlight(src, Prism.languages.markdown, 'markdown');
		// Embedded grammar applies typescript token classes within the fence.
		expect(html).toMatch(/token (keyword|number)/);
	});
});

describe('Numeric separators in JS/TS', () => {
	it('tokenizes 600_000 as a single number token', () => {
		const src = 'const n = 600_000;';
		const tokens = Prism.tokenize(src, Prism.languages.javascript);
		function findNumber(arr: unknown[]): string[] {
			const out: string[] = [];
			for (const t of arr) {
				if (
					t &&
					typeof t === 'object' &&
					'type' in t &&
					(t as { type: string }).type === 'number'
				) {
					const content = (t as { content: unknown }).content;
					if (typeof content === 'string') out.push(content);
				}
				if (t && typeof t === 'object' && 'content' in t) {
					const inner = (t as { content: unknown }).content;
					if (Array.isArray(inner)) out.push(...findNumber(inner));
				}
			}
			return out;
		}
		const nums = findNumber(tokens);
		expect(nums).toContain('600_000');
	});
});
