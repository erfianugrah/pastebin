import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DeletePaste from '../DeletePaste';

// Mock window.location
const mockPathname = '/pastes/test-paste-id/delete';
Object.defineProperty(window, 'location', {
	value: { pathname: mockPathname, href: mockPathname },
	writable: true,
});

describe('DeletePaste', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
		window.sessionStorage.clear();
	});

	it('renders the confirmation screen', () => {
		render(<DeletePaste />);
		expect(screen.getByText('Delete Paste')).toBeInTheDocument();
		expect(screen.getByText('Delete Permanently')).toBeInTheDocument();
		expect(screen.getByText('Cancel')).toBeInTheDocument();
	});

	it('displays the paste ID', () => {
		render(<DeletePaste />);
		expect(screen.getByText('test-paste-id')).toBeInTheDocument();
	});

	it('sends token in DELETE body when available in sessionStorage', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});
		globalThis.fetch = mockFetch;

		// Set up token in sessionStorage (as PasteActions would)
		window.sessionStorage.setItem('pasteriser_delete_token', 'my-secret-token');

		render(<DeletePaste />);
		fireEvent.click(screen.getByText('Delete Permanently'));

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				'/pastes/test-paste-id/delete',
				expect.objectContaining({
					method: 'DELETE',
					body: JSON.stringify({ token: 'my-secret-token' }),
				}),
			);
		});
	});

	it('falls back to localStorage token if sessionStorage is empty', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});
		globalThis.fetch = mockFetch;

		window.localStorage.setItem('paste_token_test-paste-id', 'ls-token');

		render(<DeletePaste />);
		fireEvent.click(screen.getByText('Delete Permanently'));

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				'/pastes/test-paste-id/delete',
				expect.objectContaining({
					body: JSON.stringify({ token: 'ls-token' }),
				}),
			);
		});
	});

	it('shows success state after successful delete', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});

		render(<DeletePaste />);
		fireEvent.click(screen.getByText('Delete Permanently'));

		await waitFor(() => {
			expect(screen.getByText('Paste Deleted')).toBeInTheDocument();
		});
	});

	it('shows error state when delete fails with 403', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: () => Promise.resolve({ error: { code: 'unauthorized', message: 'Unauthorized' } }),
		});

		render(<DeletePaste />);
		fireEvent.click(screen.getByText('Delete Permanently'));

		await waitFor(() => {
			expect(screen.getByText('Unauthorized')).toBeInTheDocument();
		});
	});

	it('cleans up localStorage token after successful delete', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ success: true }),
		});
		window.localStorage.setItem('paste_token_test-paste-id', 'some-token');

		render(<DeletePaste />);
		fireEvent.click(screen.getByText('Delete Permanently'));

		await waitFor(() => {
			expect(window.localStorage.getItem('paste_token_test-paste-id')).toBeNull();
		});
	});
});
