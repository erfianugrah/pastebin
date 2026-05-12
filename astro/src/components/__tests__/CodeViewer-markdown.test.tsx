// Integration test for CodeViewer's rendered-markdown panel.
// Verifies that toggling Source ⇄ Preview produces the prose container with
// the customisations from lib/markdown.ts applied (heading slugs, table
// wrapper, task list, kbd, fenced block with Prism classes).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CodeViewer from '../CodeViewer';

// Prism.highlightElement is called inside the effect; jsdom has the DOM
// but Prism may attach plugin features we don't care about here.
vi.mock('prismjs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('prismjs')>();
	return {
		default: {
			...actual.default,
			highlightElement: vi.fn(),
			plugins: { autoloader: {} },
		},
	};
});

const FUTURE_ISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const baseMd = `# Title

| a | b |
| - | - |
| 1 | 2 |

- [ ] todo
- [x] done

Press [[Ctrl]] to submit

\`\`\`ts
const x: number = 600_000;
\`\`\`
`;

function makePaste(content: string) {
	return {
		id: 'test-id',
		content,
		title: 'Markdown sample',
		language: 'markdown',
		createdAt: new Date().toISOString(),
		expiresAt: FUTURE_ISO,
		visibility: 'public' as const,
		isPasswordProtected: false,
		burnAfterReading: false,
		isEncrypted: false,
	};
}

describe('CodeViewer markdown integration', () => {
	it('toggles to rendered preview and applies all markdown customisations', () => {
		render(<CodeViewer paste={makePaste(baseMd)} />);

		// Toggle Preview mode
		fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

		// Heading with slug id
		const h1 = document.querySelector('h1#title');
		expect(h1).not.toBeNull();
		expect(h1?.textContent).toBe('Title');

		// Table wrapped in prose-table-scroll
		const wrap = document.querySelector('.prose-table-scroll');
		expect(wrap).not.toBeNull();
		expect(wrap?.querySelector('table')).not.toBeNull();
		expect(wrap?.querySelector('th')?.textContent).toBe('a');

		// Task list — disabled checkbox + .task-list-item
		const taskItems = document.querySelectorAll('li.task-list-item');
		expect(taskItems.length).toBe(2);
		taskItems.forEach((li) => {
			const checkbox = li.querySelector('input[type="checkbox"]');
			expect(checkbox).not.toBeNull();
			expect(checkbox?.hasAttribute('disabled')).toBe(true);
		});
		expect(taskItems[1].querySelector('input')?.hasAttribute('checked')).toBe(true);

		// [[kbd]] extension
		const kbd = document.querySelector('kbd');
		expect(kbd).not.toBeNull();
		expect(kbd?.textContent).toBe('Ctrl');

		// Fenced ts block — pre.language-ts.line-numbers > code.language-ts
		const pre = document.querySelector('pre.language-ts.line-numbers');
		expect(pre).not.toBeNull();
		expect(pre?.getAttribute('data-language')).toBe('ts');
		const code = pre?.querySelector('code.language-ts');
		expect(code).not.toBeNull();
		// Source text appears (entity-decoded in DOM)
		expect(code?.textContent).toContain('600_000');
	});

	it('starts in source mode and shows the raw code <pre>', () => {
		render(<CodeViewer paste={makePaste(baseMd)} />);
		// No prose container before toggling Preview
		expect(document.querySelector('.prose')).toBeNull();
		// Source <pre> is the multiline code container
		const sourcePre = document.querySelector('pre.line-numbers > code.language-markdown');
		expect(sourcePre).not.toBeNull();
	});

	it('strips script tags from markdown source via DOMPurify', () => {
		const dirty = '# safe\n\n<script>alert(1)</script>\n\nbody';
		render(<CodeViewer paste={makePaste(dirty)} />);
		fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
		const prose = document.querySelector('.prose');
		expect(prose?.innerHTML).not.toContain('<script>');
		expect(prose?.textContent).toContain('body');
	});
});
