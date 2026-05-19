// View-mode toolbar tests for CodeViewer:
//   - Source (always)
//   - Rendered (markdown only)
//   - Image (when content is one recognisable image)
//   - Wrap toggle is source-only, persists to localStorage under
//     `pasteriser_wrap`
//   - Mode auto-collapses to Source when the user-selected mode is no
//     longer applicable for the current file (multi-file scenarios)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CodeViewer from '../CodeViewer';

vi.mock('prismjs', async (importOriginal) => {
	// @types/prismjs declares no default export; the runtime module does.
	// Cast around the typing mismatch — same pattern as CodeViewer-markdown.test.tsx.
	const actual = (await importOriginal<typeof import('prismjs')>()) as unknown as {
		default: Record<string, unknown>;
	};
	return {
		default: {
			...actual.default,
			highlightElement: vi.fn(),
			plugins: { autoloader: {} },
		},
	};
});

const FUTURE_ISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function makePaste(opts: { content: string; language?: string }) {
	return {
		id: 'test-id',
		content: opts.content,
		title: 'Test',
		language: opts.language ?? 'plaintext',
		createdAt: new Date().toISOString(),
		expiresAt: FUTURE_ISO,
		visibility: 'public' as const,
		isPasswordProtected: false,
		burnAfterReading: false,
		isEncrypted: false,
	};
}

describe('CodeViewer — view modes', () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it('shows only Source button for plain code', () => {
		render(<CodeViewer paste={makePaste({ content: 'plain', language: 'plaintext' })} />);
		expect(screen.getByRole('button', { name: 'Source' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Rendered' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Image' })).toBeNull();
	});

	it('adds Rendered button for markdown', () => {
		render(<CodeViewer paste={makePaste({ content: '# hi', language: 'markdown' })} />);
		expect(screen.getByRole('button', { name: 'Rendered' })).toBeInTheDocument();
	});

	it('adds Image button when content is a recognisable image URL', () => {
		render(
			<CodeViewer
				paste={makePaste({ content: 'https://example.com/cat.png', language: 'plaintext' })}
			/>,
		);
		expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
	});

	it('Image button is hidden when content is markdown (markdown takes precedence)', () => {
		// detectImage is called with `!activeIsMarkdown` so markdown never
		// trips the image branch — even if a single ![](url) would match.
		render(
			<CodeViewer
				paste={makePaste({ content: '![](https://e.io/c.png)', language: 'markdown' })}
			/>,
		);
		expect(screen.queryByRole('button', { name: 'Image' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Rendered' })).toBeInTheDocument();
	});

	it('clicking Image renders an <img> with the detected src', () => {
		render(
			<CodeViewer
				paste={makePaste({ content: 'https://example.com/cat.png', language: 'plaintext' })}
			/>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Image' }));
		const img = screen.getByAltText('Paste preview') as HTMLImageElement;
		expect(img.src).toBe('https://example.com/cat.png');
	});

	it('clicking Rendered hides the Wrap toggle', () => {
		render(<CodeViewer paste={makePaste({ content: '# hi', language: 'markdown' })} />);
		// Source mode shows Wrap
		expect(screen.getByLabelText(/Wrap/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
		expect(screen.queryByLabelText(/Wrap/i)).toBeNull();
	});
});

describe('CodeViewer — wrap toggle', () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it('defaults to off (no whitespace-pre-wrap on the <pre>)', () => {
		render(<CodeViewer paste={makePaste({ content: 'line1\nline2', language: 'plaintext' })} />);
		const pre = document.querySelector('pre.line-numbers') as HTMLElement;
		expect(pre.className).not.toMatch(/whitespace-pre-wrap/);
	});

	it('toggling Wrap adds whitespace-pre-wrap + break-all to the <pre>', () => {
		render(<CodeViewer paste={makePaste({ content: 'line1\nline2', language: 'plaintext' })} />);
		const wrap = screen.getByLabelText(/Wrap/i) as HTMLInputElement;
		fireEvent.click(wrap);
		const pre = document.querySelector('pre.line-numbers') as HTMLElement;
		expect(pre.className).toMatch(/whitespace-pre-wrap/);
		expect(pre.className).toMatch(/break-all/);
	});

	it('persists Wrap=on to localStorage under pasteriser_wrap', () => {
		render(<CodeViewer paste={makePaste({ content: 'x', language: 'plaintext' })} />);
		fireEvent.click(screen.getByLabelText(/Wrap/i));
		expect(window.localStorage.getItem('pasteriser_wrap')).toBe('1');
	});

	it('persists Wrap=off to localStorage', () => {
		window.localStorage.setItem('pasteriser_wrap', '1');
		render(<CodeViewer paste={makePaste({ content: 'x', language: 'plaintext' })} />);
		// Initial render reads from localStorage and starts checked.
		const wrap = screen.getByLabelText(/Wrap/i) as HTMLInputElement;
		expect(wrap.checked).toBe(true);

		fireEvent.click(wrap);
		expect(window.localStorage.getItem('pasteriser_wrap')).toBe('0');
	});

	it('restores Wrap=on from localStorage on mount', () => {
		window.localStorage.setItem('pasteriser_wrap', '1');
		render(<CodeViewer paste={makePaste({ content: 'x', language: 'plaintext' })} />);
		const pre = document.querySelector('pre.line-numbers') as HTMLElement;
		expect(pre.className).toMatch(/whitespace-pre-wrap/);
	});
});
