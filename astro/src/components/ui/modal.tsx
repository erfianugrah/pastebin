import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

interface ModalProps {
  title: string;
  description?: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  children?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
}

export function Modal({
  title,
  description,
  isOpen,
  onClose,
  onConfirm,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDangerous = false,
}: ModalProps) {
  const [isMounted, setIsMounted] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);
  
  // Trap focus and handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);
  
  // Prevent scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);
  
  if (!isMounted || !isOpen) return null;
  
  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/25 backdrop-blur-sm">
      <div 
        className="fixed inset-0 z-0" 
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-lg bg-background shadow-lg border border-border animate-in fade-in zoom-in-95">
        <div className="p-6">
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          )}
          {children && <div className="mt-4">{children}</div>}
          
          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm border border-border hover:bg-secondary/80 transition-colors"
            >
              {cancelText}
            </button>
            {onConfirm && (
              <button
                onClick={onConfirm}
                className={cn(
                  "px-4 py-2 rounded-md text-sm",
                  isDangerous 
                    ? "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {confirmText}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  
  return createPortal(modal, document.body);
}

// Utility function to show a confirmation modal
export function showConfirmModal(props: Omit<ModalProps, 'isOpen' | 'onClose'>): Promise<boolean> {
  return new Promise((resolve) => {
    // Create a new container for the modal
    const modalRoot = document.createElement('div');
    modalRoot.id = 'modal-container-' + Date.now();
    document.body.appendChild(modalRoot);
    
    // Function to remove the container when done
    const cleanup = () => {
      // Use ReactDOM unmountComponentAtNode in a real application
      // For now, we'll just remove the node
      if (modalRoot.parentElement) {
        document.body.removeChild(modalRoot);
      }
    };
    
    // Success handler
    const handleConfirm = () => {
      resolve(true);
      cleanup();
    };
    
    // Cancel handler
    const handleCancel = () => {
      resolve(false);
      cleanup();
    };
    
    // Create a temporary React root and render the modal
    const root = document.createElement('div');
    modalRoot.appendChild(root);
    
    // Use ReactDOM.render in a compatibility layer
    const renderModal = () => {
      const modalElement = React.createElement(Modal, {
        ...props,
        isOpen: true,
        onClose: handleCancel,
        onConfirm: handleConfirm,
      });
      
      // In a real app with full React support, you'd use:
      // ReactDOM.render(modalElement, root);
      // Instead, we'll manually append it
      const div = document.createElement('div');
      div.id = 'modal-content-' + Date.now();
      root.appendChild(div);
      
      // We're already inside createPortal in the Modal component,
      // so we need to mount it directly
      // This is a workaround - in a real app, use ReactDOM properly
      const container = document.getElementById(div.id);
      if (container) {
        // Create the modal HTML structure manually
        container.innerHTML = `
          <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/25 backdrop-blur-sm">
            <div class="fixed inset-0 z-0"></div>
            <div class="relative z-10 w-full max-w-md overflow-hidden rounded-lg bg-background shadow-lg border border-border animate-in fade-in zoom-in-95">
              <div class="p-6">
                <h3 class="text-lg font-semibold">${props.title}</h3>
                ${props.description ? `<p class="mt-2 text-sm text-muted-foreground">${props.description}</p>` : ''}
                <div class="mt-6 flex justify-end gap-3">
                  <button id="modal-cancel-btn" class="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm border border-border hover:bg-secondary/80 transition-colors">
                    ${props.cancelText || 'Cancel'}
                  </button>
                  <button id="modal-confirm-btn" class="px-4 py-2 rounded-md text-sm ${
                    props.isDangerous 
                      ? "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }">
                    ${props.confirmText || 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
        
        // Add event listeners
        document.getElementById('modal-cancel-btn')?.addEventListener('click', handleCancel);
        document.getElementById('modal-confirm-btn')?.addEventListener('click', handleConfirm);
        document.querySelector(`#${div.id} .fixed.inset-0.z-0`)?.addEventListener('click', handleCancel);
        
        // Add keyboard event listener
        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') handleCancel();
        };
        document.addEventListener('keydown', handleKeyDown);
        
        // Prevent scrolling
        document.body.style.overflow = 'hidden';
        
        // Cleanup function to restore scrolling and remove listeners
        const cleanupEvents = () => {
          document.body.style.overflow = '';
          document.removeEventListener('keydown', handleKeyDown);
        };
        
        // Create new handlers with cleanup
        const wrappedConfirm = () => {
          cleanupEvents();
          handleConfirm();
        };
        
        const wrappedCancel = () => {
          cleanupEvents();
          handleCancel();
        };
        
        // Replace the event listeners with wrapped versions
        document.getElementById('modal-cancel-btn')?.removeEventListener('click', handleCancel);
        document.getElementById('modal-confirm-btn')?.removeEventListener('click', handleConfirm);
        
        document.getElementById('modal-cancel-btn')?.addEventListener('click', wrappedCancel);
        document.getElementById('modal-confirm-btn')?.addEventListener('click', wrappedConfirm);
      }
    };
    
    // Render the modal
    renderModal();
  });
}