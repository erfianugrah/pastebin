import { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';

export interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  onClose?: () => void;
}

export function Toast({ 
  message, 
  type = 'success', 
  duration = 3000, 
  onClose 
}: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  // Auto-dismiss after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      if (onClose) onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const typeClasses = {
    success: "bg-green-100 border-green-400 text-green-800 dark:bg-green-900/30 dark:border-green-800 dark:text-green-300",
    error: "bg-red-100 border-red-400 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-300",
    info: "bg-blue-100 border-blue-400 text-blue-800 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300",
  };

  return isVisible ? (
    <div 
      className={cn(
        "fixed bottom-4 right-4 px-4 py-3 rounded border shadow-md z-50 max-w-md transition-all transform",
        typeClasses[type],
        isVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      )}
      role="alert"
    >
      <div className="flex items-center">
        {type === 'success' && (
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        )}
        {type === 'error' && (
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        )}
        {type === 'info' && (
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v4a1 1 0 102 0V7zm-1-5a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
          </svg>
        )}
        <span>{message}</span>
        <button 
          onClick={() => {
            setIsVisible(false);
            if (onClose) onClose();
          }}
          className="ml-4 text-current focus:outline-none"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  ) : null;
}

// Global toast management using custom events for cross-component communication
// This handles issues with Astro's partial hydration and allows any component to show toasts

// Event name for toast communication
const TOAST_EVENT = 'pasteriser-toast-event';

// Type for the toast event
type ToastEvent = {
  id: number;
  props: ToastProps;
};

// Toast counter - stored in localStorage to persist across component hydrations
const getNextId = (): number => {
  const currentId = parseInt(localStorage.getItem('pasteriser-toast-id') || '0', 10);
  const nextId = currentId + 1;
  localStorage.setItem('pasteriser-toast-id', nextId.toString());
  return nextId;
};

// Create a toast
export function toast(props: Omit<ToastProps, 'onClose'>) {
  const id = getNextId();
  
  // Create a custom event with the toast data
  const event = new CustomEvent<ToastEvent>(TOAST_EVENT, {
    detail: {
      id,
      props: {
        ...props,
        onClose: () => {
          // When a toast is closed, dispatch a close event
          window.dispatchEvent(
            new CustomEvent(`${TOAST_EVENT}-close`, {
              detail: { id }
            })
          );
        }
      }
    }
  });
  
  // Dispatch the event to be caught by the ToastContainer
  window.dispatchEvent(event);
  return id;
}

// Toast container component
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastEvent[]>([]);

  useEffect(() => {
    // Handler for adding toasts
    const handleToastEvent = (event: Event) => {
      const toastEvent = (event as CustomEvent<ToastEvent>).detail;
      setToasts(prev => [...prev, toastEvent]);
    };
    
    // Handler for removing toasts
    const handleToastCloseEvent = (event: Event) => {
      const { id } = (event as CustomEvent<{ id: number }>).detail;
      setToasts(prev => prev.filter(toast => toast.id !== id));
    };
    
    // Add event listeners
    window.addEventListener(TOAST_EVENT, handleToastEvent);
    window.addEventListener(`${TOAST_EVENT}-close`, handleToastCloseEvent);
    
    // Remove event listeners on cleanup
    return () => {
      window.removeEventListener(TOAST_EVENT, handleToastEvent);
      window.removeEventListener(`${TOAST_EVENT}-close`, handleToastCloseEvent);
    };
  }, []);

  return (
    <>
      {toasts.map(({ id, props }) => (
        <Toast key={id} {...props} />
      ))}
    </>
  );
}