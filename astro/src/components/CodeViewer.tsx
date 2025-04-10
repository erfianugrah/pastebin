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

// Ultra-simple version with no dependencies to avoid hydration issues
const CodeViewer = ({ paste }: CodeViewerProps) => {
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

  // Simple copy to clipboard function
  const copyToClipboard = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(paste.content || '')
        .then(() => alert('Copied to clipboard'))
        .catch(() => alert('Failed to copy'));
    } else {
      alert('Clipboard access not available');
    }
  };

  // Handle delete
  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this paste? This action cannot be undone.')) {
      window.location.href = `/pastes/${paste.id}/delete`;
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>{paste.title || 'Untitled Paste'}</div>
        <div style={styles.metadata}>
          <div>Created: {formatDate(paste.createdAt)}</div>
          <div>Expires: {formatDate(paste.expiresAt)}</div>
          {paste.language && <div>Language: {paste.language}</div>}
          <div>Visibility: {paste.visibility === 'public' ? 'Public' : 'Private'}</div>
          {paste.isPasswordProtected && <div>Password protected</div>}
          {paste.burnAfterReading && <div>Burn after reading</div>}
        </div>
      </div>
      
      <div style={styles.content}>
        {paste.burnAfterReading && (
          <div style={styles.warning}>
            Warning: This paste will be permanently deleted after viewing.
          </div>
        )}
        
        <pre style={styles.pre}>
          <code>{paste.content || ' '}</code>
        </pre>
      </div>
      
      <div style={styles.footer}>
        <div>
          <button onClick={() => window.location.href = '/'} style={styles.button}>
            Create New Paste
          </button>
          <button onClick={() => window.open(`/pastes/raw/${paste.id}`, '_blank')} style={styles.button}>
            View Raw
          </button>
          <button onClick={handleDelete} style={{...styles.button, ...styles.dangerButton}}>
            Delete
          </button>
        </div>
        <div>
          <button onClick={copyToClipboard} style={styles.button}>
            Copy to Clipboard
          </button>
        </div>
      </div>
    </div>
  );
};

export default CodeViewer;