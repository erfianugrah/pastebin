import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../modal';

describe('Modal', () => {
	it('renders nothing when closed', () => {
		const { container } = render(
			<Modal title="Test" isOpen={false} onClose={() => {}} />
		);
		// Modal uses portal, so check document.body
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('renders when open', () => {
		render(
			<Modal title="Test Modal" isOpen={true} onClose={() => {}} />
		);
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Test Modal')).toBeInTheDocument();
	});

	it('does not violate Rules of Hooks when toggling open/closed', () => {
		// This is the exact bug we fixed — useId() was after early return
		const { rerender } = render(
			<Modal title="Test" isOpen={false} onClose={() => {}} />
		);

		// Should not throw when opening
		expect(() => {
			rerender(<Modal title="Test" isOpen={true} onClose={() => {}} />);
		}).not.toThrow();

		// Should not throw when closing
		expect(() => {
			rerender(<Modal title="Test" isOpen={false} onClose={() => {}} />);
		}).not.toThrow();

		// Should not throw when re-opening
		expect(() => {
			rerender(<Modal title="Test" isOpen={true} onClose={() => {}} />);
		}).not.toThrow();
	});

	it('calls onClose when Escape is pressed', () => {
		const onClose = vi.fn();
		render(<Modal title="Test" isOpen={true} onClose={onClose} />);

		fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('calls onConfirm when confirm button is clicked', () => {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		render(
			<Modal title="Test" isOpen={true} onClose={onClose} onConfirm={onConfirm} confirmText="Yes" />
		);

		fireEvent.click(screen.getByText('Yes'));
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it('renders description when provided', () => {
		render(
			<Modal title="Test" description="A description" isOpen={true} onClose={() => {}} />
		);
		expect(screen.getByText('A description')).toBeInTheDocument();
	});

	it('renders children when provided', () => {
		render(
			<Modal title="Test" isOpen={true} onClose={() => {}}>
				<p>Child content</p>
			</Modal>
		);
		expect(screen.getByText('Child content')).toBeInTheDocument();
	});
});
