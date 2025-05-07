import { useState, useEffect, useRef } from 'react';
import { decryptData, deriveKeyFromPassword } from '../lib/crypto';
import { toast } from './ui/toast';
import util from 'tweetnacl-util';
import { ExpirationCountdown } from './ExpirationCountdown';

// Extract decodeBase64 from the CommonJS module
const { decodeBase64 } = util;

// Add Prism type declaration
declare global {
  interface Window {
    Prism: {
      highlightElement: (element: HTMLElement) => void;
    };
  }
}

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
  version?: string;
  securityType?: string;
  hasViewLimit?: boolean;
  viewLimit?: number;
  remainingViews?: number;
}

interface CodeViewerProps {
  paste: PasteData;
}

export default function CodeViewer({ paste }: CodeViewerProps) {
  // Add debugging info to console
  console.log('CodeViewer: Paste data received:', { 
    id: paste.id,
    isEncrypted: paste.isEncrypted,
    isPasswordProtected: paste.isPasswordProtected,
    visibility: paste.visibility,
    contentLength: paste.content?.length || 0,
    version: paste.version,
    securityType: paste.securityType
  });

  const [content, setContent] = useState<string>(paste.content);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decrypted, setDecrypted] = useState(false);
  const [isLargeFile, setIsLargeFile] = useState(false);
  const [visibleContent, setVisibleContent] = useState<string>('');
  const [fullContentLoaded, setFullContentLoaded] = useState(false);
  const [decryptionProgress, setDecryptionProgress] = useState<number | null>(null);
  const codeRef = useRef<HTMLElement>(null);
  
  // Define threshold for large files (5MB)
  const largeFileThreshold = 5 * 1024 * 1024;
  
  // Handle large file progressive loading
  useEffect(() => {
    const contentToProcess = decrypted ? content : paste.content;
    const isLarge = contentToProcess.length > largeFileThreshold;
    setIsLargeFile(isLarge);
    
    if (isLarge) {
      // Initially show just the first part of the content
      const initialChunkSize = 100 * 1024; // 100KB
      setVisibleContent(contentToProcess.slice(0, initialChunkSize));
      
      // Load the rest of the content after a short delay
      const loadFullContent = () => {
        setVisibleContent(contentToProcess);
        setFullContentLoaded(true);
      };
      
      const timeoutId = setTimeout(loadFullContent, 100);
      return () => clearTimeout(timeoutId);
    } else {
      // For smaller files, show everything immediately
      setVisibleContent(contentToProcess);
      setFullContentLoaded(true);
      return undefined; // Explicit return for TypeScript
    }
  }, [content, paste.content, decrypted, largeFileThreshold]);

  // Syntax highlighting effect
  useEffect(() => {
    if (fullContentLoaded && window.Prism && codeRef.current) {
      // Apply syntax highlighting
      window.Prism.highlightElement(codeRef.current);
    }
  }, [fullContentLoaded]);

  const [passwordInput, setPasswordInput] = useState<string>('');
  const [showPasswordForm, setShowPasswordForm] = useState<boolean>(false);
  
  useEffect(() => {
    // Check for encryption key in URL fragment, localStorage, or prompt for password
    async function attemptDecryption() {
      // Only skip decryption if the paste is not encrypted
      if (!paste.isEncrypted) {
        console.log('CodeViewer: Non-encrypted paste - skipping decryption');
        return;
      }
      
      if (!decrypted) {
        console.log(`CodeViewer: Encrypted ${paste.visibility} paste detected, attempting decryption`);
        try {
          setIsDecrypting(true);
          
          // Get key from URL fragment
          const urlHash = window.location.hash.substring(1);
          console.log('URL fragment:', urlHash);
          
          // Handle both URL query param style (?key=xxx) and direct fragment (#key=xxx)
          let key;
          try {
            // First try to extract the key with regex to preserve the exact encoding
            const directMatch = urlHash.match(/key=([^&]+)/);
            if (directMatch && directMatch[1]) {
              // Use the raw match to preserve '+' and other special characters
              key = directMatch[1];
              console.log('Found key with regex match');
            } else {
              // If regex fails, try URLSearchParams
              const hashParams = new URLSearchParams(urlHash);
              key = hashParams.get('key');
              
              if (key) {
                // URLSearchParams converts '+' to space, so convert spaces back to '+'
                key = key.replace(/ /g, '+');
                console.log('Found key with URLSearchParams, fixed spaces');
              }
            }
            
            // Apply decoding to handle URL-encoded characters, especially for Base64 special chars
            if (key) {
              try {
                // First check for percent-encoded characters
                if (key.includes('%')) {
                  key = decodeURIComponent(key);
                  console.log('Decoded URI-encoded key');
                }
                
                // Handle the special case of the older format where + might have been encoded as %2B
                // and then decoded to a space by URLSearchParams
                if (key.includes(' ')) {
                  key = key.replace(/ /g, '+');
                  console.log('Replaced spaces with plus signs in key');
                }
                
                // Recover any potentially encoded Base64 special characters
                key = key.replace(/%2B/g, '+').replace(/%2F/g, '/').replace(/%3D/g, '=');
                
                console.log('Key prepared for decryption');
              } catch (decodeError) {
                console.warn('Error processing encryption key:', decodeError);
                // Keep using the original key if processing fails
              }
            }
          } catch (e) {
            console.warn('Error parsing URL fragment:', e);
          }
          
          // Check localStorage for saved key if not in URL
          const savedKey = !key && paste.id ? localStorage.getItem(`paste_key_${paste.id}`) : null;
          
          console.log('isEncrypted:', paste.isEncrypted);
          console.log('Encryption key found:', key ? 'URL' : (savedKey ? 'Local Storage' : 'No'));
          console.log('Content length:', paste.content.length);
          
          // If we have either a URL key or a saved key
          if (key || savedKey) {
            const keyToUse = key || savedKey;
            
            try {
              console.log('Attempting to decrypt content with key');
              // Check if this is a large paste that needs progress reporting
              const isLarge = paste.content.length > 10000;
              
              if (isLarge) {
                setDecryptionProgress(0);
              }
              
              // Attempt decryption with the key
              const decryptedContent = await decryptData(
                paste.content, 
                keyToUse || '',
                false,
                isLarge ? (progress) => {
                  setDecryptionProgress(progress.percent);
                } : undefined
              );
              
              setDecryptionProgress(100);
              console.log('Decryption successful, content length:', decryptedContent.length);
              
              // Update state with decrypted content
              setContent(decryptedContent);
              setDecrypted(true);
              
              // Show different toast messages depending on key source
              if (savedKey && !key) {
                toast({
                  message: 'Content decrypted with saved key',
                  type: 'success',
                });
              } else {
                toast({
                  message: 'Content decrypted successfully',
                  type: 'success',
                });
              }
              
              // If we used a URL key, save it to localStorage for future use
              if (key && paste.id) {
                try {
                  localStorage.setItem(`paste_key_${paste.id}`, key);
                  console.log('Saved encryption key to localStorage');
                } catch (e) {
                  console.error('Failed to save key to localStorage:', e);
                }
              }
            } catch (error) {
              console.error('Decryption failed:', error);
              
              // If we tried with a saved key and it failed, remove it
              if (savedKey && paste.id) {
                try {
                  localStorage.removeItem(`paste_key_${paste.id}`);
                  console.log('Removed invalid saved key from localStorage');
                } catch (e) {
                  console.error('Failed to remove key from localStorage:', e);
                }
              }
              
              // Key failed, might be a password-protected paste
              setShowPasswordForm(true);
              
              toast({
                message: 'Failed to decrypt with key. This paste may require a password.',
                type: 'error',
              });
            }
          } else {
            // No key available, check if this looks like a password-protected paste
            try {
              // Peek at the encrypted data to see if it has the salt+nonce+ciphertext format
              const encryptedData = decodeBase64(paste.content);
              
              // If the length is at least SALT_LENGTH + nonceLength (16 + 24), it might be password-protected
              if (encryptedData.length > 40) {
                setShowPasswordForm(true);
                toast({
                  message: 'This content is password-protected. Please enter the password.',
                  type: 'info',
                  duration: 5000,
                });
              } else {
                toast({
                  message: 'This content is encrypted. You need the decryption key to view it.',
                  type: 'info',
                  duration: 5000,
                });
              }
            } catch (e) {
              toast({
                message: 'This content is encrypted. You need the decryption key to view it.',
                type: 'info',
                duration: 5000,
              });
            }
          }
        } catch (error) {
          console.error('Error during decryption process:', error);
        } finally {
          setIsDecrypting(false);
        }
      }
    }
    
    attemptDecryption();
  }, [paste.content, paste.id, paste.isEncrypted, decrypted]);
  
  // Handle password form submission
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    
    setIsDecrypting(true);
    setShowPasswordForm(false);
    
    try {
      // Attempt to decrypt with password
      console.log('Attempting to decrypt with password');
      // Check if this is a large paste that needs progress reporting
      const isLarge = paste.content.length > 10000;
      
      if (isLarge) {
        setDecryptionProgress(0);
      }
      
      // Decrypt with progress reporting
      const decryptedContent = await decryptData(
        paste.content, 
        passwordInput, 
        true,
        isLarge ? (progress) => {
          setDecryptionProgress(progress.percent);
        } : undefined
      );
      
      setDecryptionProgress(100);
      setContent(decryptedContent);
      setDecrypted(true);
      
      toast({
        message: 'Content decrypted successfully',
        type: 'success',
      });
      
      // Get user permission to remember password
      const rememberPassword = window.confirm(
        'Would you like to save this password securely in your browser for future visits to this paste?'
      );
      
      if (rememberPassword && paste.id) {
        try {
          // We don't store the actual password, but we can derive and store a key
          // that will work for this specific paste
          const { key, salt } = await deriveKeyFromPassword(passwordInput);
          
          // Use a special format to indicate this is a derived key, not a direct key
          localStorage.setItem(`paste_key_${paste.id}`, `dk:${salt}:${key}`);
          
          console.log('Saved password-derived key to localStorage');
          toast({
            message: 'Password saved securely for this paste',
            type: 'success',
            duration: 2000
          });
        } catch (e) {
          console.error('Failed to save password to localStorage:', e);
        }
      }
    } catch (error) {
      console.error('Password decryption failed:', error);
      
      toast({
        message: 'Invalid password. Please try again.',
        type: 'error',
      });
      
      // Show the password form again
      setShowPasswordForm(true);
    } finally {
      setIsDecrypting(false);
    }
  };

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
          
          {/* ExpirationCountdown instead of static expires text */}
          <span className="flex items-center">
            <ExpirationCountdown expiresAt={paste.expiresAt} />
          </span>
          
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
              <span className={`flex items-center font-medium ${
                decrypted ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'
              }`}>
                {decrypted ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                    <span>E2E Decrypted</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span>E2E Encrypted</span>
                  </>
                )}
              </span>
            </>
          )}
          
          {paste.burnAfterReading && (
            <>
              <span className="hidden sm:inline">•</span>
              <span className="flex items-center text-red-600 dark:text-red-400 font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
                <span>Self-destruct</span>
              </span>
            </>
          )}
          
          {/* View limit indicator */}
          {paste.hasViewLimit && (
            <>
              <span className="hidden sm:inline">•</span>
              <span className="flex items-center text-amber-600 dark:text-amber-400 font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span>
                  {paste.remainingViews === 1 ? (
                    "Final view"
                  ) : (
                    `${paste.remainingViews} view${paste.remainingViews !== 1 ? 's' : ''} remaining`
                  )}
                </span>
              </span>
            </>
          )}
        </div>
      </div>
      
      {/* Success notification after decryption - only for private pastes */}
      {paste.isEncrypted && decrypted && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 rounded-md mb-4 flex items-start">
          <div className="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-green-800 dark:text-green-300">Successfully decrypted</h3>
            <div className="mt-1 text-xs text-green-700 dark:text-green-400">
              <p>This content was decrypted in your browser using end-to-end encryption.</p>
            </div>
          </div>
        </div>
      )}
      
      {/* View limit warning for final view */}
      {paste.hasViewLimit && paste.remainingViews === 1 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-md mb-4 flex items-start">
          <div className="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Final View</h3>
            <div className="mt-1 text-xs text-red-700 dark:text-red-400">
              <p>This is your final viewing of this content. After you leave this page, it will be permanently deleted.</p>
            </div>
          </div>
        </div>
      )}
      
      {/* View limit information */}
      {paste.hasViewLimit && paste.remainingViews && paste.remainingViews > 1 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-md mb-4 flex items-start">
          <div className="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-amber-800 dark:text-amber-300">Limited Views</h3>
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              <p>This content has a view limit of {paste.viewLimit} views total. It will be automatically deleted after reaching the limit.</p>
              <p className="mt-1 font-medium">{paste.remainingViews} views remaining.</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Encryption notice - shown while still encrypted - only for encrypted pastes */}
      {paste.isEncrypted && !decrypted && !isDecrypting && !showPasswordForm && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4 rounded-md mb-4 flex items-start">
          <div className="flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300">End-to-End Encrypted Content</h3>
            <div className="mt-1 text-xs text-yellow-700 dark:text-yellow-400">
              <p>This paste is encrypted and requires a decryption key or password.</p>
              <p className="mt-1">If you received a complete URL with a decryption key, make sure you've entered the entire URL including the part after the # symbol.</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Decryption in progress */}
      {isDecrypting && (
        <div className="flex flex-col justify-center items-center p-8">
          {decryptionProgress !== null ? (
            <div className="w-full max-w-md mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">Decrypting ({decryptionProgress}%)</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-in-out" 
                  style={{ width: `${decryptionProgress}%` }}
                ></div>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">
                {decryptionProgress < 30 ? "Preparing decryption..." : 
                 decryptionProgress < 90 ? "Decrypting content..." : 
                 "Finalizing decryption..."}
              </p>
            </div>
          ) : (
            <>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span className="ml-2">Decrypting content...</span>
            </>
          )}
        </div>
      )}
      
      {/* Code content */}
      <div className={`${isDecrypting ? 'opacity-50' : ''} relative`}>
        <pre className={`p-4 rounded-md overflow-x-auto bg-gray-100 dark:bg-gray-800 font-mono text-sm max-h-[600px] ${paste.isEncrypted && !decrypted ? 'blur-sm' : ''}`}>
          <code ref={codeRef} className={`language-${paste.language || 'plaintext'}`}>
            {visibleContent}
          </code>
        </pre>
        
        {/* Loading indicator for large files */}
        {isLargeFile && !fullContentLoaded && !isDecrypting && (
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-gray-100/90 dark:from-gray-800/90 to-transparent py-4 flex justify-center">
            <div className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm flex items-center">
              <div className="animate-spin mr-2 rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent"></div>
              Loading complete file... ({Math.round(content.length / 1024)}KB)
            </div>
          </div>
        )}
      </div>
      
      {/* Password form - only show for encrypted pastes when explicity requested */}
      {paste.isEncrypted && !decrypted && showPasswordForm && (
        <div className="mt-4 p-6 bg-muted/30 rounded-md border border-border shadow-sm">
          <div className="flex items-center mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h3 className="font-bold text-lg">Password Protected Content</h3>
          </div>
          
          <p className="text-sm text-muted-foreground mb-4 pl-7">
            This content is encrypted with end-to-end encryption. 
            Enter the password that was used during creation to decrypt it.
          </p>
          
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  <span className="font-medium">Privacy Note:</span> Decryption happens in your browser. The password is never sent to the server.
                </p>
              </div>
            </div>
          </div>
          
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label htmlFor="decrypt-password" className="block text-sm font-medium mb-1">Decryption Password</label>
              <div className="relative">
                <input
                  id="decrypt-password"
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-input rounded-md bg-background"
                  placeholder="Enter the password..."
                  autoComplete="current-password"
                  autoFocus
                  required
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <button
                type="submit"
                className="inline-flex items-center bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
                disabled={isDecrypting || !passwordInput.trim()}
              >
                {isDecrypting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Decrypting...</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                    <span>Decrypt Content</span>
                  </>
                )}
              </button>
              
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setShowPasswordForm(false)}
              >
                Try URL key instead
              </button>
            </div>
          </form>
        </div>
      )}
      
      {/* Encrypted content message - key missing - only show for private pastes */}
      {paste.isEncrypted && !decrypted && !showPasswordForm && !isDecrypting && (
        <div className="mt-6 max-w-md mx-auto">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-5 shadow-sm">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-amber-800 dark:text-amber-300 font-medium">Encrypted Content</h3>
                <div className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                  <p>This content is encrypted with end-to-end encryption and requires a decryption key or password.</p>
                </div>
                <div className="mt-4">
                  <div className="-mx-2 -my-1.5 flex flex-wrap gap-2">
                    <button 
                      onClick={() => setShowPasswordForm(true)}
                      className="px-3 py-1.5 bg-amber-100 dark:bg-amber-800 text-amber-800 dark:text-amber-200 rounded-md text-sm font-medium hover:bg-amber-200 dark:hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 dark:focus:ring-offset-amber-900"
                    >
                      Enter Password
                    </button>
                    
                    {/* Check for saved keys and offer to restore them */}
                    {paste.id && (
                      <button
                        onClick={() => {
                          // Look for any keys in local storage for this paste
                          const pasteKeys = Object.keys(localStorage)
                            .filter(key => key === `paste_key_${paste.id}`)
                            .map(key => localStorage.getItem(key));
                            
                          if (pasteKeys.length > 0) {
                            setIsDecrypting(true);
                            // Force a re-render which will trigger the useEffect to try the saved key
                            setTimeout(() => window.location.reload(), 500);
                            toast({
                              message: 'Trying saved decryption key...',
                              type: 'info',
                              duration: 2000
                            });
                          } else {
                            toast({
                              message: 'No saved keys found for this paste',
                              type: 'error',
                              duration: 3000
                            });
                          }
                        }}
                        className="px-3 py-1.5 bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-md text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-blue-900"
                      >
                        Try Saved Key
                      </button>
                    )}
                    
                    <a 
                      href="https://docs.example.com/encrypted-pastes" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-transparent text-amber-800 dark:text-amber-300 rounded-md text-sm font-medium hover:bg-amber-50 dark:hover:bg-amber-900/30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
                    >
                      Learn More
                    </a>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-4 border-t border-amber-200 dark:border-amber-700 pt-4">
              <p className="text-sm text-amber-600 dark:text-amber-300">
                <strong>Missing decryption key:</strong> The complete URL should contain a decryption key after the # symbol. 
                If you have a password instead, click "Enter Password" above.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}