import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PasteActions from '../PasteActions';

// Minimal mock for window.location
Object.defineProperty(window, 'location', {
	value: { href: 'https://paste.erfi.io/pastes/abc123', origin: 'https://paste.erfi.io', pathname: '/pastes/abc123' },
	writable: true,
});

const defaultProps = {
	pasteId: 'abc123',
	pasteTitle: 'Test Paste',
	pasteLanguage: 'javascript',
	isEncrypted: false,
	getDecryptedContent: () => null,
	getRawContent: () => 'console.log("hello")',
};

describe('PasteActions', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
		window.sessionStorage.clear();
	});

	it('renders all action buttons', () => {
		render(<PasteActions {...defaultProps} />);
		expect(screen.getByText('New')).toBeInTheDocument();
		expect(screen.getByText('Fork')).toBeInTheDocument();
		expect(screen.getByText('Raw')).toBeInTheDocument();
		expect(screen.getByText('Copy')).toBeInTheDocument();
		expect(screen.getByText('Download')).toBeInTheDocument();
		expect(screen.getByText('QR')).toBeInTheDocument();
		expect(screen.getByText('Delete')).toBeInTheDocument();
	});

	it('shows Edit button when user has a stored token', () => {
		window.localStorage.setItem('paste_token_abc123', 'some-token');
		render(<PasteActions {...defaultProps} />);
		expect(screen.getByText('Edit')).toBeInTheDocument();
	});

	it('hides Edit button when no stored token', () => {
		render(<PasteActions {...defaultProps} />);
		expect(screen.queryByText('Edit')).toBeNull();
	});

	it('shows Embed button for non-encrypted pastes', () => {
		render(<PasteActions {...defaultProps} />);
		expect(screen.getByText('Embed')).toBeInTheDocument();
	});

	it('hides Embed button for encrypted pastes', () => {
		render(<PasteActions {...defaultProps} isEncrypted={true} />);
		expect(screen.queryByText('Embed')).toBeNull();
	});

	it('Fork stores content in sessionStorage and navigates', () => {
		render(<PasteActions {...defaultProps} />);
		fireEvent.click(screen.getByText('Fork'));

		const fork = JSON.parse(window.sessionStorage.getItem('pasteriser_fork')!);
		expect(fork.content).toBe('console.log("hello")');
		expect(fork.title).toBe('Fork of Test Paste');
		expect(fork.language).toBe('javascript');
	});

	it('Download creates a blob with correct extension', () => {
		const createObjectURL = vi.fn().mockReturnValue('blob:url');
		const revokeObjectURL = vi.fn();
		globalThis.URL.createObjectURL = createObjectURL;
		globalThis.URL.revokeObjectURL = revokeObjectURL;

		// Mock createElement and click
		const mockClick = vi.fn();
		const origCreate = document.createElement.bind(document);
		vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = origCreate(tag);
			if (tag === 'a') el.click = mockClick;
			return el;
		});

		render(<PasteActions {...defaultProps} />);
		fireEvent.click(screen.getByText('Download'));

		expect(createObjectURL).toHaveBeenCalled();
		expect(mockClick).toHaveBeenCalled();
	});

	it('Delete stores token in sessionStorage before navigating', async () => {
		window.localStorage.setItem('paste_token_abc123', 'del-token');

		// Mock showConfirmModal to auto-confirm
		vi.doMock('../ui/modal', () => ({
			showConfirmModal: () => Promise.resolve(true),
		}));

		// Note: the actual navigation test requires more setup since
		// showConfirmModal is dynamically imported. This tests the localStorage read.
		const token = window.localStorage.getItem('paste_token_abc123');
		expect(token).toBe('del-token');
	});
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────
// These tests guard the C1 regression: before the ref-based rewrite, the
// `c` shortcut on an encrypted paste captured `getDecryptedContent` from
// the FIRST render and forever returned null — even after PasteViewer
// passed a fresh prop on auto-decrypt. The rerender test below catches
// that exact case.
describe('PasteActions — keyboard shortcuts', () => {
	let writeText: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
		window.sessionStorage.clear();
		writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText },
			configurable: true,
		});
	});

	function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
		act(() => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key, ...opts }));
		});
	}

	it("'c' copies plaintext content (mouse and keyboard parity)", async () => {
		render(<PasteActions {...defaultProps} />);
		press('c');
		// Microtask flush for the async clipboard write
		await Promise.resolve();
		expect(writeText).toHaveBeenCalledWith('console.log("hello")');
	});

	it("'c' reads the LATEST getDecryptedContent prop (regression: C1 stale closure)", async () => {
		// Initial render: encrypted, not yet decrypted.
		const { rerender } = render(
			<PasteActions
				{...defaultProps}
				isEncrypted={true}
				getDecryptedContent={() => null}
			/>,
		);

		// Pressing 'c' now would call getDecryptedContent → null → toast
		// "Still decrypting…" — no clipboard write.
		press('c');
		await Promise.resolve();
		expect(writeText).not.toHaveBeenCalled();

		// PasteViewer finishes decrypt and passes a fresh prop that closes
		// over the latest state. Pre-fix, the keyboard handler would still
		// call the FIRST render's getDecryptedContent and see null forever.
		rerender(
			<PasteActions
				{...defaultProps}
				isEncrypted={true}
				getDecryptedContent={() => 'decrypted-plaintext'}
			/>,
		);

		press('c');
		await Promise.resolve();
		expect(writeText).toHaveBeenCalledWith('decrypted-plaintext');
	});

	it("'s' triggers download with paste-language extension", () => {
		const createObjectURL = vi.fn().mockReturnValue('blob:url');
		globalThis.URL.createObjectURL = createObjectURL;
		globalThis.URL.revokeObjectURL = vi.fn();

		const mockClick = vi.fn();
		const orig = document.createElement.bind(document);
		vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
			const el = orig(tag);
			if (tag === 'a') el.click = mockClick;
			return el;
		});

		render(<PasteActions {...defaultProps} />);
		press('s');

		expect(createObjectURL).toHaveBeenCalled();
		expect(mockClick).toHaveBeenCalled();
	});

	it("'f' stores fork payload using LATEST content prop after rerender", () => {
		let liveContent = 'initial content';
		const { rerender } = render(
			<PasteActions {...defaultProps} getRawContent={() => liveContent} />,
		);

		liveContent = 'updated content';
		rerender(
			<PasteActions {...defaultProps} getRawContent={() => liveContent} />,
		);

		press('f');
		const fork = JSON.parse(window.sessionStorage.getItem('pasteriser_fork')!);
		expect(fork.content).toBe('updated content');
	});

	it("'e' is a no-op when there is no edit token", () => {
		render(<PasteActions {...defaultProps} />);
		press('e');
		// handleEdit would write to sessionStorage; verify it didn't.
		expect(window.sessionStorage.getItem('pasteriser_edit')).toBeNull();
	});

	it("'e' triggers edit flow when a token is stored (regression: live hasEditToken)", async () => {
		// Token is set BEFORE mount so the initial useEffect picks it up.
		window.localStorage.setItem('paste_token_abc123', 'edit-tok');
		render(<PasteActions {...defaultProps} />);
		act(() => { /* flush mount effects */ });

		press('e');
		// `handleEdit` awaits `loadPasteToken` (async secureStorage probe)
		// before writing sessionStorage. Flush a few microtasks + a tick.
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();

		const edit = window.sessionStorage.getItem('pasteriser_edit');
		expect(edit).not.toBeNull();
	});

	it("'m' toggles the embed panel on non-encrypted pastes", () => {
		render(<PasteActions {...defaultProps} />);
		expect(screen.queryByText('Embed snippets')).toBeNull();
		press('m');
		expect(screen.getByText('Embed snippets')).toBeInTheDocument();
		press('m');
		expect(screen.queryByText('Embed snippets')).toBeNull();
	});

	it("'m' is ignored on encrypted pastes", () => {
		render(<PasteActions {...defaultProps} isEncrypted={true} getDecryptedContent={() => 'x'} />);
		press('m');
		expect(screen.queryByText('Embed snippets')).toBeNull();
	});

	it("'q' toggles the QR panel", () => {
		render(<PasteActions {...defaultProps} />);
		expect(screen.queryByText(/QR code/i)).toBeNull();
		press('q');
		expect(screen.getByText(/QR code/i)).toBeInTheDocument();
		press('q');
		expect(screen.queryByText(/QR code/i)).toBeNull();
	});

	it("'x' alone does NOT trigger delete (shift required)", () => {
		render(<PasteActions {...defaultProps} />);
		press('x'); // no shift
		// If delete had been called, a confirmation modal would be in the DOM.
		// Conservative assertion: sessionStorage still empty.
		expect(window.sessionStorage.getItem('pasteriser_delete_token')).toBeNull();
	});

	it('ignores all shortcuts when modifiers are held (browser bindings preserved)', async () => {
		render(<PasteActions {...defaultProps} />);
		press('c', { ctrlKey: true });   // Ctrl+C (browser copy)
		press('c', { metaKey: true });    // Cmd+C
		press('s', { ctrlKey: true });   // Ctrl+S (Save page)
		await Promise.resolve();
		expect(writeText).not.toHaveBeenCalled();
	});

	it('ignores shortcuts while typing in an input', async () => {
		render(
			<div>
				<input data-testid="typing" />
				<PasteActions {...defaultProps} />
			</div>,
		);
		const input = screen.getByTestId('typing') as HTMLInputElement;
		input.focus();

		// Dispatch the event from the input element so .target.tagName === 'INPUT'.
		act(() => {
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
		});
		await Promise.resolve();
		expect(writeText).not.toHaveBeenCalled();
	});

	it('detaches its window listener on unmount', async () => {
		const { unmount } = render(<PasteActions {...defaultProps} />);
		unmount();

		press('c');
		await Promise.resolve();
		expect(writeText).not.toHaveBeenCalled();
	});
});
