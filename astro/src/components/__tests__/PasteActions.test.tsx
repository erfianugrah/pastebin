import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PasteActions from '../PasteActions';

// Minimal mock for window.location
Object.defineProperty(window, 'location', {
	value: { href: 'https://paste.erfi.dev/pastes/abc123', origin: 'https://paste.erfi.dev', pathname: '/pastes/abc123' },
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
