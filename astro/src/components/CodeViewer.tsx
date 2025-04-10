import { useState, useEffect } from 'react';
import { decryptData } from '../lib/crypto';
import { toast } from './ui/toast';

interface PasteData {
  id: string;
  content: string;
  title?: string;
  language?: string;
  createdAt: string;
  expiresAt: string;
  visibility: 'public' | 'private';
  isPasswordProtected: boolean;
  burnAfterReading: boolean;
  isEncrypted?: boolean;
}

interface CodeViewerProps {
  paste: PasteData;
}

export default function CodeViewer({ paste }: CodeViewerProps) {
  const [content, setContent] = useState<string>(paste.content);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decrypted, setDecrypted] = useState(false);
  
  useEffect(() => {
    // Check for encryption key in URL fragment and attempt decryption
    async function attemptDecryption() {
      if (paste.isEncrypted && !decrypted) {
        try {
          // Get key from URL fragment
          const urlHash = window.location.hash.substring(1);
          console.log('URL fragment:', urlHash);
          
          const hashParams = new URLSearchParams(urlHash);
          const key = hashParams.get('key');
          
          console.log('isEncrypted:', paste.isEncrypted);
          console.log('Encryption key found:', key ? 'Yes' : 'No');
          console.log('Content length:', paste.content.length);
          
          if (key) {
            setIsDecrypting(true);
            
            try {
              console.log('Attempting to decrypt content with key length:', key.length);
              // Attempt decryption with the key
              const decryptedContent = await decryptData(paste.content, key);
              console.log('Decryption successful, content length:', decryptedContent.length);
              
              // Update state with decrypted content
              setContent(decryptedContent);
              setDecrypted(true);
              
              toast({
                message: 'Content decrypted successfully',
                type: 'success',
              });
            } catch (error) {
              console.error('Decryption failed:', error);
              console.error('Key used:', key);
              console.error('Content sample:', paste.content.substring(0, 50));
              
              toast({
                message: 'Failed to decrypt content. Invalid key.',
                type: 'error',
              });
            }
          } else if (paste.isEncrypted) {
            toast({
              message: 'This content is encrypted. You need the decryption key to view it.',
              type: 'info',
              duration: 5000,
            });
          }
        } catch (error) {
          console.error('Error during decryption process:', error);
        } finally {
          setIsDecrypting(false);
        }
      }
    }
    
    attemptDecryption();
  }, [paste.content, paste.isEncrypted, decrypted]);

  // Format the date
  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleString();
  }

  return (
    <div className="w-full">
      {/* Paste metadata */}
      <div className="mb-4 border-b pb-4">
        <h2 className="text-2xl font-bold mb-2">
          {paste.title || `Untitled Paste`}
        </h2>
        
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <span>Created: {formatDate(paste.createdAt)}</span>
          <span className="hidden sm:inline">•</span>
          <span>Expires: {formatDate(paste.expiresAt)}</span>
          {paste.language && (
            <>
              <span className="hidden sm:inline">•</span>
              <span>Language: {paste.language}</span>
            </>
          )}
          <span className="hidden sm:inline">•</span>
          <span>Visibility: {paste.visibility}</span>
          
          {paste.isEncrypted && (
            <>
              <span className="hidden sm:inline">•</span>
              <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                {decrypted ? 'Decrypted' : 'Encrypted'}
              </span>
            </>
          )}
          
          {paste.burnAfterReading && (
            <>
              <span className="hidden sm:inline">•</span>
              <span className="text-red-600 dark:text-red-400 font-medium">
                Burn after reading
              </span>
            </>
          )}
        </div>
      </div>
      
      {/* Encryption notice */}
      {paste.isEncrypted && !decrypted && !isDecrypting && (
        <div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 p-4 rounded-md mb-4">
          <h3 className="font-bold text-yellow-800 dark:text-yellow-300">Encrypted Content</h3>
          <p className="text-yellow-800 dark:text-yellow-300 mt-1">
            This paste is encrypted and requires a decryption key. 
            The key should be in the URL after the # symbol.
          </p>
        </div>
      )}
      
      {/* Decryption in progress */}
      {isDecrypting && (
        <div className="flex justify-center items-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="ml-2">Decrypting content...</span>
        </div>
      )}
      
      {/* Code content */}
      <div className={`${isDecrypting ? 'opacity-50' : ''}`}>
        <pre className={`p-4 rounded-md overflow-x-auto bg-gray-100 dark:bg-gray-800 font-mono text-sm max-h-[600px] ${paste.isEncrypted && !decrypted ? 'blur-sm' : ''}`}>
          <code>{content}</code>
        </pre>
      </div>
      
      {/* Encrypted content message */}
      {paste.isEncrypted && !decrypted && (
        <div className="mt-4 text-center">
          <p className="text-sm text-muted-foreground">
            To view this content, you need the complete URL with the decryption key (after the # symbol).
          </p>
        </div>
      )}
    </div>
  );
}