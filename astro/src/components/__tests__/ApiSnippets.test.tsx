import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ApiSnippets from '../ApiSnippets';

// Flushes the microtask queue + any React state updates queued by it.
async function flush() {
	await act(async () => {
		await Promise.resolve();
	});
}

describe('ApiSnippets', () => {
	let writeText: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText },
			configurable: true,
		});
	});

	it('renders all three snippets with title strips', () => {
		render(<ApiSnippets />);
		expect(screen.getByText('curl — create a paste')).toBeInTheDocument();
		expect(screen.getByText('curl — pipe a file')).toBeInTheDocument();
		expect(screen.getByText('fetch — JavaScript')).toBeInTheDocument();
	});

	it('renders one Copy button per snippet (no Prism toolbar duplicates)', () => {
		// Regression for the May-2026 double-copy bug: Prism's
		// copy-to-clipboard plugin auto-injects a button when
		// Prism.highlightElement fires. The component switched to the
		// string API (Prism.highlight) to skip the plugin hooks, so the
		// only Copy buttons in the DOM should be the three we render.
		render(<ApiSnippets />);
		const copies = screen.getAllByRole('button', { name: /^Copy / });
		expect(copies).toHaveLength(3);

		// And no .code-toolbar wrapper should have been added by Prism.
		expect(document.querySelector('.code-toolbar')).toBeNull();
	});

	it('applies bash syntax highlighting to curl snippets', () => {
		render(<ApiSnippets />);

		// Find the <code> element for the first curl snippet by traversing
		// from the title strip to its sibling <pre>.
		const codes = document.querySelectorAll('code.language-bash');
		expect(codes.length).toBe(2);

		// Verify Prism actually emitted classed tokens (e.g. `<span class=
		// "token function">curl</span>`), proving the grammar was loaded
		// synchronously and not lost to the autoloader race.
		const firstCurl = codes[0] as HTMLElement;
		expect(firstCurl.querySelector('.token')).not.toBeNull();
	});

	it('applies javascript syntax highlighting to the fetch snippet', () => {
		render(<ApiSnippets />);
		const jsCode = document.querySelector('code.language-javascript');
		expect(jsCode).not.toBeNull();
		expect((jsCode as HTMLElement).querySelector('.token')).not.toBeNull();
	});

	it('Copy button writes the snippet to the clipboard', async () => {
		render(<ApiSnippets />);
		const firstCopy = screen.getByRole('button', { name: 'Copy curl — create a paste' });

		fireEvent.click(firstCopy);
		await flush();

		expect(writeText).toHaveBeenCalledTimes(1);
		const written = writeText.mock.calls[0][0] as string;
		expect(written).toMatch(/^curl -X POST/);
		expect(written).toContain('https://paste.erfi.io/pastes');
	});

	it('each Copy button copies its own snippet, not a sibling', async () => {
		render(<ApiSnippets />);

		const copyPipe = screen.getByRole('button', { name: 'Copy curl — pipe a file' });
		fireEvent.click(copyPipe);
		await flush();
		expect(writeText.mock.calls[0][0]).toContain('cat file.py | jq');

		const copyFetch = screen.getByRole('button', { name: 'Copy fetch — JavaScript' });
		fireEvent.click(copyFetch);
		await flush();
		expect(writeText.mock.calls[1][0]).toMatch(/await fetch/);
	});

	it('shows ✓ Copied feedback after a successful copy', async () => {
		render(<ApiSnippets />);
		const btn = screen.getByRole('button', { name: 'Copy curl — create a paste' });

		fireEvent.click(btn);
		await flush();
		expect(screen.getByText('✓ Copied')).toBeInTheDocument();
	});

	it('does not crash when navigator.clipboard.writeText rejects', async () => {
		writeText.mockRejectedValueOnce(new Error('clipboard denied'));
		render(<ApiSnippets />);
		const btn = screen.getByRole('button', { name: 'Copy curl — create a paste' });

		fireEvent.click(btn);
		// Flush the rejection — should be caught and turned into a toast.
		await flush();
		// No ✓ Copied transition on failure.
		expect(screen.queryByText('✓ Copied')).toBeNull();
	});
});
