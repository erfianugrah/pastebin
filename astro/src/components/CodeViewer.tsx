import { useEffect, useRef, useState } from 'react';
import { toast } from './ui/toast';
import { Modal } from './ui/modal';
// Note: Typically we'd add these imports, but they'll be handled in Layout.astro instead
// import Prism from 'prismjs';
// import 'prismjs/themes/prism.css';
// import 'prismjs/themes/prism-tomorrow.css';

// Add Prism to the window global type
declare global {
  interface Window {
    Prism: {
      highlightAll: () => void;
      highlightElement: (element: HTMLElement) => void;
    };
  }
}

// Define the type for paste properties
interface PasteProps {
  id: string;
  content: string;
  title?: string;
  language?: string;
  createdAt: string;
  expiresAt: string;
  visibility: 'public' | 'private';
  isPasswordProtected?: boolean;
  burnAfterReading?: boolean;
  readCount?: number;
}

interface CodeViewerProps {
  paste: PasteProps;
}

// CodeViewer component with syntax highlighting
const CodeViewer = ({ paste }: CodeViewerProps) => {
  const codeRef = useRef<HTMLElement>(null);

  // Create a second ref for dark mode highlighting
  const darkCodeRef = useRef<HTMLElement>(null);

  // Apply syntax highlighting when component mounts or language/content changes
  useEffect(() => {
    // Prism.js is loaded globally in Layout.astro
    // This will apply highlighting via the client-side JS 
    if (paste.language && paste.language !== 'plaintext') {
      try {
        // Prism will be available globally via window.Prism
        if (window.Prism && typeof window.Prism.highlightAll === 'function') {
          // Prism will automatically highlight elements with class="language-xxx"
          window.Prism.highlightAll();
        } else {
          console.warn('Prism.js not loaded or initialized');
        }
      } catch (e) {
        console.error('Failed to apply syntax highlighting:', e);
      }
    }
  }, [paste.content, paste.language]);
  // Basic styles as inline styles to avoid any dependency issues
  const styles = {
    container: {
      maxWidth: '900px',
      margin: '0 auto',
      fontFamily: 'sans-serif',
      border: '1px solid #e2e8f0',
      borderRadius: '0.5rem',
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
      overflow: 'hidden',
      backgroundColor: '#fff',
    },
    header: {
      padding: '1rem',
      borderBottom: '1px solid #e2e8f0',
    },
    title: {
      fontSize: '1.25rem',
      fontWeight: 'bold',
      marginBottom: '0.5rem',
    },
    metadata: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: '0.5rem',
      fontSize: '0.875rem',
      color: '#64748b',
    },
    content: {
      padding: '1rem',
    },
    pre: {
      backgroundColor: '#f8fafc',
      padding: '1rem',
      overflow: 'auto' as const, // Use 'auto' which is valid for both CSS and React props
      border: '1px solid #e2e8f0',
      borderRadius: '0.25rem',
      fontSize: '0.875rem',
      fontFamily: 'monospace',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap' as const,
    },
    footer: {
      padding: '1rem',
      borderTop: '1px solid #e2e8f0',
      display: 'flex',
      justifyContent: 'space-between',
    },
    button: {
      padding: '0.5rem 1rem',
      backgroundColor: '#f1f5f9',
      border: '1px solid #e2e8f0',
      borderRadius: '0.25rem',
      cursor: 'pointer',
      marginRight: '0.5rem',
      fontSize: '0.875rem',
    },
    dangerButton: {
      backgroundColor: '#fee2e2',
      color: '#b91c1c',
      border: '1px solid #fecaca',
    },
    line: {
      margin: 0,
      padding: 0,
    },
    warning: {
      backgroundColor: '#ffedd5',
      border: '1px solid #fed7aa',
      padding: '0.75rem',
      borderRadius: '0.25rem',
      marginBottom: '1rem',
      color: '#9a3412',
    }
  };

  // Format date helper function
  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return dateString || 'Unknown';
    }
  };

  // Enhanced copy to clipboard function
  const copyToClipboard = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(paste.content || '')
        .then(() => {
          toast({ 
            message: 'Copied to clipboard!', 
            type: 'success',
            duration: 2000
          });
        })
        .catch(() => {
          toast({ 
            message: 'Failed to copy to clipboard', 
            type: 'error',
            duration: 3000
          });
        });
    } else {
      toast({ 
        message: 'Clipboard access not available in your browser', 
        type: 'error',
        duration: 3000
      });
    }
  };

  // State for delete confirmation modal
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  
  // Handle delete
  const handleDelete = () => {
    setIsDeleteModalOpen(true);
  };
  
  // Handle confirmation
  const confirmDelete = () => {
    window.location.href = `/pastes/${paste.id}/delete`;
  };

  return (
    <div className="bg-card text-card-foreground max-w-[900px] mx-auto font-sans border border-border rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b border-border">
        <div className="text-xl font-bold mb-2">{paste.title || 'Untitled Paste'}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-sm text-muted-foreground">
          <div>Created: {formatDate(paste.createdAt)}</div>
          <div>Expires: {formatDate(paste.expiresAt)}</div>
          {paste.language && <div>Language: {paste.language}</div>}
          <div>Visibility: {paste.visibility === 'public' ? 'Public' : 'Private'}</div>
          {paste.isPasswordProtected && <div>Password protected</div>}
          {paste.burnAfterReading && <div>Burn after reading</div>}
        </div>
      </div>
      
      <div className="p-4">
        {paste.burnAfterReading && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 rounded mb-4 text-amber-800 dark:text-amber-300">
            Warning: This paste will be permanently deleted after viewing.
          </div>
        )}
        
        <pre className="bg-muted/50 dark:bg-muted p-4 overflow-auto border border-border rounded text-sm font-mono leading-relaxed w-full text-left line-numbers">
          <code 
            ref={codeRef}
            className={`w-full block text-left ${paste.language ? `language-${paste.language}` : ''}`}
          >
            {paste.content || ' '}
          </code>
        </pre>
      </div>
      
      <div className="p-4 border-t border-border flex justify-between flex-wrap gap-2">
        <div className="space-x-2 space-y-2 sm:space-y-0">
          <button 
            onClick={() => window.location.href = '/'} 
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded text-sm border border-border hover:bg-secondary/80 transition-colors"
          >
            Create New Paste
          </button>
          <button 
            onClick={() => window.open(`/pastes/raw/${paste.id}`, '_blank')} 
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded text-sm border border-border hover:bg-secondary/80 transition-colors"
          >
            View Raw
          </button>
          <button 
            onClick={handleDelete} 
            className="px-4 py-2 bg-destructive/10 text-destructive rounded text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors"
          >
            Delete
          </button>
        </div>
        <div>
          <button 
            onClick={copyToClipboard} 
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded text-sm border border-border hover:bg-secondary/80 transition-colors"
          >
            Copy to Clipboard
          </button>
        </div>
      </div>
      
      {/* Delete confirmation modal */}
      <Modal
        title="Delete Paste"
        description="Are you sure you want to delete this paste? This action cannot be undone."
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        confirmText="Delete"
        cancelText="Cancel"
        isDangerous={true}
      />
    </div>
  );
};

export default CodeViewer;