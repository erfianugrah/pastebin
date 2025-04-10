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
let modalRoot: HTMLDivElement | null = null;

export function showConfirmModal(props: Omit<ModalProps, 'isOpen' | 'onClose'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!modalRoot) {
      modalRoot = document.createElement('div');
      modalRoot.id = 'modal-root';
      document.body.appendChild(modalRoot);
    }
    
    const container = document.createElement('div');
    modalRoot.appendChild(container);
    
    const cleanup = () => {
      if (container.parentElement === modalRoot) {
        modalRoot.removeChild(container);
      }
    };
    
    const handleConfirm = () => {
      resolve(true);
      cleanup();
    };
    
    const handleCancel = () => {
      resolve(false);
      cleanup();
    };
    
    const modalProps: ModalProps = {
      ...props,
      isOpen: true,
      onClose: handleCancel,
      onConfirm: handleConfirm,
    };
    
    const modalElement = React.createElement(Modal, modalProps);
    createPortal(modalElement, container);
  });
}