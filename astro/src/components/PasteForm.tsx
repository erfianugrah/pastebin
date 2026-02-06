import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';
import { toast } from './ui/toast';
import { Tooltip } from './ui/tooltip';
import { PasswordStrengthMeter } from './ui/password-strength';
import { generateEncryptionKey, encryptData, deriveKeyFromPassword } from '../lib/crypto';
import { validatePasteForm } from '../lib/validation';
import { useErrorHandler } from '../hooks/useErrorHandler';

export default function PasteForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{[key: string]: string}>({});
  const [result, setResult] = useState<{id: string, url: string, encryptionKey?: string} | null>(null);
  const [isE2EEncrypted, setIsE2EEncrypted] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');
  const [securityMethod, setSecurityMethod] = useState<'none' | 'password' | 'key'>('none');
  const [encryptionProgress, setEncryptionProgress] = useState<number | null>(null);
  
  // Use our error handler hook
  const { handleError } = useErrorHandler();
  
  // Keep security method in sync with encryption state
  useEffect(() => {
    if (isE2EEncrypted && securityMethod === 'none') {
      setSecurityMethod(passwordValue ? 'password' : 'key');
    } else if (!isE2EEncrypted && securityMethod !== 'none') {
      setSecurityMethod('none');
    }
  }, [isE2EEncrypted, passwordValue]);
  
  const validateForm = (formData: FormData) => {
    const errors: {[key: string]: string} = {};
    
    // Convert FormData to Record<string, string> for validation
    const formFields: Record<string, string> = {};
    formData.forEach((value, key) => {
      formFields[key] = value.toString();
    });
    
    // Use the validation utility
    const validationErrors = validatePasteForm(formFields);
    
    // Convert validation errors to simple string format for compatibility
    for (const [field, error] of Object.entries(validationErrors)) {
      errors[field] = error.message;
    }
    
    // Add warning for large pastes
    const content = formData.get('content') as string;
    if (content && content.length > 5 * 1024 * 1024) { // 5MB warning
      console.warn('Large paste detected:', Math.floor(content.length / (1024 * 1024)), 'MB');
    }
    
    return errors;
  };
  
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setFormErrors({});
    setEncryptionProgress(null); // Reset progress
    
    try {
      const form = e.target as HTMLFormElement;
      const formData = new FormData(form);
      
      // Validate form
      const errors = validateForm(formData);
      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        setIsSubmitting(false);
        return;
      }
      
      // Get values from form
      const content = formData.get('content') as string;
      const title = formData.get('title') as string;
      const language = formData.get('language') as string;
      const expiration = parseInt(formData.get('expiration') as string, 10);
      const visibility = formData.get('visibility') as string;
      const password = formData.get('password') as string;
      const burnAfterReading = formData.get('burnAfterReading') === 'on';
      const e2eEncryption = formData.get('e2eEncryption') === 'on';
      
      // Get view limit values
      const viewLimitEnabled = formData.get('enableViewLimit') === 'on' || formData.get('viewLimitEnabled') === 'true';
      const viewLimit = viewLimitEnabled ? parseInt(formData.get('viewLimit') as string, 10) : undefined;
      
      let encryptedContent = content;
      let encryptionKey: string | undefined;
      let passwordHash: string | undefined;
      
      // Handle client-side encryption (if private or e2e encryption is selected)
      if (e2eEncryption || (visibility === 'private' && isE2EEncrypted)) {
        try {
          if (password) {
            // Password-based encryption
            // Step 1: Derive key from password using PBKDF2
            const { key: derivedKey, salt } = await deriveKeyFromPassword(password);
            console.log('Derived key from password with salt');
            
            // Step 2: Encrypt content with password-derived key
            encryptedContent = await encryptData(content, derivedKey, true, salt);
            console.log('Content encrypted with password-derived key');
            
            // We don't need to send a password to the server at all
            // Just mark that this content is encrypted
            passwordHash = undefined;
          } else {
            // Random key encryption
            // Step 1: Generate a secure random key
            encryptionKey = generateEncryptionKey();
            console.log('Generated random encryption key');
            
            // Step 2: Encrypt the content with this key
            setEncryptionProgress(0); // Start encryption progress
            
            try {
              // Do the actual encryption with progress tracking
              encryptedContent = await encryptData(
                content, 
                encryptionKey, 
                false, 
                undefined,
                (progress) => {
                  console.log('Real encryption progress:', progress.percent);
                  setEncryptionProgress(progress.percent);
                }
              );
              
              // Ensure 100% is shown at the end
              setEncryptionProgress(100);
            } catch (error) {
              console.error('Encryption failed:', error);
              throw error;
            }
            
            // We already set progress to 100% inside the try block
            console.log('Content encrypted successfully with random key');
          }
        } catch (error) {
          console.error('Encryption error:', error);
          // Add more context to the error
          const enhancedError = new Error('Failed to encrypt content. Please try again.');
          // Add original error details to help with debugging
          (enhancedError as any).originalError = error;
          (enhancedError as any).code = 'encryption_failed';
          throw enhancedError;
        }
      } else if (password) {
        // In Phase 3, all passwords must use client-side encryption
        // Auto-convert any password to client-side encryption
        console.info('Using client-side encryption with password protection (required in Phase 3)');
        
        try {
          // Use client-side encryption by default
          
          try {
            // Initialize progress
            setEncryptionProgress(0);
            
            // First phase: Derive key with progress tracking (0-30%)
            const { key: derivedKey, salt } = await deriveKeyFromPassword(
              password,
              undefined,
              (keyProgress) => {
                // Scale key derivation progress to 0-30% range
                const scaledProgress = Math.floor(keyProgress.percent * 0.3);
                console.log('Key derivation progress:', scaledProgress);
                setEncryptionProgress(scaledProgress);
              }
            );
            console.log('Derived key from password with salt');
            
            // Second phase: Encrypt with the derived key (30-100%)
            encryptedContent = await encryptData(
              content, 
              derivedKey, 
              true, 
              salt,
              (encryptProgress) => {
                // Scale encryption progress to 30-100% range
                const scaledProgress = 30 + Math.floor(encryptProgress.percent * 0.7);
                console.log('Password encryption progress:', scaledProgress);
                setEncryptionProgress(scaledProgress);
              }
            );
            
            // Ensure 100% is shown at the end
            setEncryptionProgress(100);
          } catch (error) {
            console.error('Password encryption failed:', error);
            throw error;
          }
          
          // We already set progress to 100% inside the try block
          console.log('Content encrypted with password-derived key');
          
          // Set encryption flag for response
          // We can't modify e2eEncryption directly as it's a function parameter
          
          // No password hash needed for server - passwords always use client-side encryption now
          passwordHash = undefined;
        } catch (error) {
          console.error('Encryption error:', error);
          // Add more context to the error
          const enhancedError = new Error('Failed to encrypt content with password. Please try again.');
          // Add original error details to help with debugging
          (enhancedError as any).originalError = error;
          (enhancedError as any).code = 'password_encryption_failed';
          throw enhancedError;
        }
      }
      
      // Log encryption status for debugging (development only)
      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        console.log('Creating paste:', {
          isEncrypted: !!(e2eEncryption || (visibility === 'private' && isE2EEncrypted)),
          contentLength: encryptedContent.length,
          hasPassword: !!passwordHash
        });
      }

      // Send request to create the paste
      const response = await fetch('/pastes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content: encryptedContent,
          language,
          expiration,
          visibility,
          password: passwordHash,
          burnAfterReading,
          isEncrypted: !!(e2eEncryption || (securityMethod !== 'none' && isE2EEncrypted)),
          viewLimit: viewLimitEnabled ? viewLimit : undefined,
          // Add version to track encryption method (1=server-side, 2=client-side)
          version: (e2eEncryption || (securityMethod !== 'none' && isE2EEncrypted)) ? 2 : 0,
        }),
      }).catch(fetchError => {
        console.error('Network error:', fetchError);
        const networkError = new Error('Network error. Please check your connection and try again.');
        (networkError as any).originalError = fetchError;
        (networkError as any).code = 'network_error';
        throw networkError;
      });
      
      if (!response.ok) {
        const errorData = await response.json() as { error?: { message?: string, code?: string } };
        const serverError = new Error(errorData.error?.message || 'Failed to create paste');
        (serverError as any).code = errorData.error?.code || 'server_error';
        (serverError as any).status = response.status;
        throw serverError;
      }
      
      const data = await response.json() as { id: string; url: string };
      
      // If using client-side encryption, append the key to the URL fragment
      // The fragment is not sent to the server
      let resultUrl = data.url;
      if (e2eEncryption || (visibility === 'private' && isE2EEncrypted)) {
        // Keep the "+" character as-is by using encodeURIComponent and then replacing %2B back to +
        // This ensures proper handling of Base64 keys that may contain "+" characters
        // Note: Base64 characters "+", "/" and "=" need to be properly handled in URLs
        const encodedKey = encryptionKey ? encryptionKey.replace(/\+/g, "%2B").replace(/\//g, "%2F").replace(/=/g, "%3D") : "";
        resultUrl = `${data.url}#key=${encodedKey}`;
        console.log('Added encryption key to URL fragment');
      }
      
      // Handle the encryptionKey prop to avoid type issues with undefined
      const resultData = {
        id: data.id,
        url: resultUrl,
      };
      
      // Only add the encryptionKey property if it exists
      if (e2eEncryption || (visibility === 'private' && isE2EEncrypted)) {
        Object.assign(resultData, { encryptionKey });
      }
      
      setResult(resultData);
      
      toast({
        message: 'Paste created successfully!',
        type: 'success',
      });
    } catch (error) {
      // Use our error handler
      handleError(error, {
        location: 'PasteForm.handleSubmit',
        formData: {
          hasTitle: !!(document.getElementById('title') as HTMLInputElement | null)?.value,
          contentLength: (document.getElementById('content') as HTMLTextAreaElement | null)?.value?.length || 0,
          visibility: (() => {
            const el = document.getElementById('visibility');
            return el instanceof HTMLSelectElement ? el.value : 'unknown';
          })(),
          isE2EEncrypted
        }
      });
    } finally {
      setIsSubmitting(false);
    }
  }
  
  return (
    <Card className="w-full max-w-3xl mx-auto bg-white/90 dark:bg-card/95">
      <CardHeader>
        <CardTitle>Create New Paste</CardTitle>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="text-center p-4">
            <h2 className="text-xl font-bold mb-2">Paste Created!</h2>
            <p className="mb-4">Your paste is available at:</p>
            <div className="relative bg-muted p-2 rounded-md mb-4 overflow-x-auto group">
              <a 
                href={result.url} 
                className="text-primary font-mono text-sm hover:underline pr-8"
                target="_blank" 
                rel="noopener noreferrer"
              >
                {result.url}
              </a>
              <button
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(result.url).then(() => {
                      toast({
                        message: 'URL copied to clipboard!',
                        type: 'success',
                        duration: 2000
                      });
                    }).catch(err => {
                      console.error('Could not copy URL: ', err);
                      toast({
                        message: 'Failed to copy URL',
                        type: 'error',
                        duration: 3000
                      });
                    });
                  }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-primary hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="Copy URL to clipboard"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
              </button>
            </div>
            
            {result.encryptionKey && (
              <div className="mt-4 mb-4">
                <p className="mb-2 text-yellow-600 dark:text-yellow-400 font-bold">
                  Important Security Notice
                </p>
                <p className="mb-3 text-sm">
                  This paste is end-to-end encrypted. The decryption key is included in the URL after the # symbol.
                  <br />The server cannot decrypt this content without this key.
                </p>
                
                <div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 p-3 rounded-md mb-3">
                  <div className="flex justify-between items-start">
                    <p className="text-sm text-yellow-800 dark:text-yellow-300">
                      Share the complete URL including the part after # to allow others to decrypt this paste.
                    </p>
                    
                    <div className="ml-2 flex-shrink-0">
                      <div className="relative">
                        <button
                          onClick={async () => {
                            // Store the key in secure storage with the paste ID as the key
                            if (typeof window !== 'undefined' && result.id && result.encryptionKey) {
                              try {
                                const { secureStore } = await import('../lib/secureStorage');
                                await secureStore(`paste_key_${result.id}`, result.encryptionKey);
                                toast({
                                  message: 'Encryption key saved securely to browser',
                                  type: 'success',
                                  duration: 2000
                                });
                              } catch (secureError) {
                                console.error('Failed to save key to secure storage, falling back:', secureError);
                                try {
                                  localStorage.setItem(`paste_key_${result.id}`, result.encryptionKey);
                                  toast({
                                    message: 'Encryption key saved to browser',
                                    type: 'success',
                                    duration: 2000
                                  });
                                } catch (e) {
                                  console.error('Failed to save key to localStorage:', e);
                                  toast({
                                    message: 'Failed to save encryption key',
                                    type: 'error',
                                    duration: 3000
                                  });
                                }
                              }
                            }
                          }}
                          className="px-2 py-1 text-xs font-medium text-yellow-700 dark:text-yellow-300 bg-yellow-200 dark:bg-yellow-800 rounded hover:bg-yellow-300 dark:hover:bg-yellow-700 transition-colors"
                          title="Save key to this browser"
                        >
                          Save Key
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Display the encryption key with copy button */}
                  <div className="mt-2 pt-2 border-t border-yellow-200 dark:border-yellow-700">
                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-1">Encryption Key:</p>
                    <div className="relative flex">
                      <div className="bg-yellow-50 dark:bg-yellow-900/50 p-1.5 rounded text-xs font-mono text-yellow-800 dark:text-yellow-300 overflow-x-auto flex-grow">
                        {result.encryptionKey}
                      </div>
                      <button
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(result.encryptionKey || '').then(() => {
                              toast({
                                message: 'Encryption key copied!',
                                type: 'success',
                                duration: 2000
                              });
                            }).catch(err => {
                              console.error('Could not copy key: ', err);
                              toast({
                                message: 'Failed to copy key',
                                type: 'error',
                                duration: 3000
                              });
                            });
                          }
                        }}
                        className="ml-1 p-1 rounded-md text-yellow-600 hover:text-yellow-800 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-colors"
                        title="Copy key to clipboard"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div className="mt-6">
              <Button 
                onClick={() => setResult(null)}
                variant="outline"
              >
                Create Another Paste
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium mb-1">
                Title (optional)
              </label>
              <input
                id="title"
                name="title"
                type="text"
                placeholder="Untitled Paste"
                className={`w-full rounded-md border ${formErrors.title ? 'border-destructive' : 'border-input'} bg-background px-3 py-2`}
              />
              {formErrors.title && (
                <p className="text-destructive text-sm mt-1">{formErrors.title}</p>
              )}
            </div>
            
            <div>
              <label htmlFor="content" className="block text-sm font-medium mb-1">
                Content <span className="text-destructive">*</span>
              </label>
              <Textarea
                id="content"
                name="content"
                placeholder="Paste your content here..."
                rows={12}
                required
                className={`font-mono bg-background ${formErrors.content ? 'border-destructive' : ''}`}
              />
              {formErrors.content && (
                <p className="text-destructive text-sm mt-1">{formErrors.content}</p>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="language" className="block text-sm font-medium mb-1">
                  Language (optional)
                </label>
                <select
                  id="language"
                  name="language"
                  className="w-full rounded-md border border-input px-3 py-2 bg-background text-foreground"
                >
                  <option value="">Plain Text</option>
                  
                  {/* Web Development */}
                  <optgroup label="Web Development">
                    <option value="markup">HTML</option>
                    <option value="css">CSS</option>
                    <option value="javascript">JavaScript</option>
                    <option value="typescript">TypeScript</option>
                    <option value="jsx">JSX</option>
                    <option value="tsx">TSX</option>
                    <option value="php">PHP</option>
                  </optgroup>
                  
                  {/* Data Formats */}
                  <optgroup label="Data Formats">
                    <option value="json">JSON</option>
                    <option value="xml-doc">XML</option>
                    <option value="yaml">YAML</option>
                    <option value="toml">TOML</option>
                    <option value="ini">INI</option>
                    <option value="csv">CSV</option>
                  </optgroup>
                  
                  {/* Infrastructure & DevOps */}
                  <optgroup label="Infrastructure & DevOps">
                    <option value="hcl">HCL (Terraform)</option>
                    <option value="docker">Dockerfile</option>
                    <option value="bash">Bash</option>
                    <option value="shell-session">Shell</option>
                    <option value="powershell">PowerShell</option>
                    <option value="nginx">Nginx</option>
                  </optgroup>
                  
                  {/* Programming Languages */}
                  <optgroup label="Programming Languages">
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="csharp">C#</option>
                    <option value="c">C</option>
                    <option value="cpp">C++</option>
                    <option value="go">Go</option>
                    <option value="rust">Rust</option>
                    <option value="ruby">Ruby</option>
                    <option value="kotlin">Kotlin</option>
                    <option value="swift">Swift</option>
                    <option value="scala">Scala</option>
                    <option value="perl">Perl</option>
                    <option value="r">R</option>
                  </optgroup>
                  
                  {/* Database */}
                  <optgroup label="Database">
                    <option value="sql">SQL</option>
                    <option value="mongodb">MongoDB</option>
                    <option value="graphql">GraphQL</option>
                  </optgroup>
                  
                  {/* Markup & Style */}
                  <optgroup label="Markup & Style">
                    <option value="markdown">Markdown</option>
                    <option value="latex">LaTeX</option>
                    <option value="scss">SCSS</option>
                    <option value="less">LESS</option>
                  </optgroup>
                  
                  {/* Configuration */}
                  <optgroup label="Configuration">
                    <option value="apache">Apache</option>
                    <option value="properties">Properties</option>
                  </optgroup>
                </select>
              </div>
              
              <div>
                <label htmlFor="expiration" className="block text-sm font-medium mb-1">
                  Expiration
                </label>
                <select
                  id="expiration"
                  name="expiration"
                  className="w-full rounded-md border border-input px-3 py-2 bg-background text-foreground"
                >
                  <option value="3600">1 hour</option>
                  <option value="86400" selected>1 day</option>
                  <option value="604800">1 week</option>
                  <option value="2592000">30 days</option>
                  <option value="31536000">1 year</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="visibility" className="block text-sm font-medium mb-1">
                  Visibility
                </label>
                <select
                  id="visibility"
                  name="visibility"
                  className="w-full rounded-md border border-input px-3 py-2 bg-background text-foreground"
                  onChange={(e) => {
                    if (e.target.value === 'private') {
                      // Suggest encryption for private pastes but don't force it
                      // Only set E2E encryption if a security method is already chosen
                      if (securityMethod !== 'none') {
                        setIsE2EEncrypted(true);
                      }
                      // Inform the user that encryption is recommended for private pastes
                      toast({
                        message: 'Encryption is recommended for private pastes',
                        type: 'info',
                        duration: 3000
                      });
                    }
                  }}
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>
              
              <div>
                <div className="flex items-center mb-1">
                  <label htmlFor="securityMethod" className="block text-sm font-medium">
                    Security
                  </label>
                  <Tooltip 
                    content={
                      <div className="p-1">
                        <p className="font-medium mb-1">Choose your encryption method:</p>
                        <ul className="list-disc ml-4 space-y-1">
                          <li><strong>None</strong>: Content stored as plaintext</li>
                          <li><strong>Password</strong>: Encrypted with PBKDF2 key derivation</li>
                          <li><strong>Key</strong>: Secured with 256-bit random key</li>
                        </ul>
                        <p className="mt-1 text-xs">All encryption is end-to-end (E2EE)</p>
                      </div>
                    }
                    position="top"
                  >
                    <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold cursor-help">?</span>
                  </Tooltip>
                </div>
                
                <select
                  id="securityMethod"
                  name="securityMethod"
                  className="w-full rounded-md border border-input px-3 py-2 bg-background text-foreground"
                  onChange={(e) => {
                    const value = e.target.value as 'none' | 'password' | 'key';
                    setSecurityMethod(value);
                    
                    if (value === 'none') {
                      setIsE2EEncrypted(false);
                      // Clear password field
                      setPasswordValue('');
                    } else if (value === 'password' || value === 'key') {
                      setIsE2EEncrypted(true);
                      
                      // If switching to key mode, clear any existing password
                      if (value === 'key') {
                        setPasswordValue('');
                      }
                    }
                  }}
                  value={!isE2EEncrypted ? 'none' : securityMethod === 'none' ? (passwordValue ? 'password' : 'key') : securityMethod}
                >
                  <option value="none">None (Plaintext)</option>
                  <option value="password">Password Protection (E2EE) - Recommended</option>
                  <option value="key">Key Protection (E2EE)</option>
                </select>
                
                <div className="text-xs text-muted-foreground mt-1 flex items-start">
                  <div className="mt-0.5 mr-1 flex-shrink-0">
                    {!isE2EEncrypted ? 
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      : 
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    }
                  </div>
                  <span>
                    {!isE2EEncrypted ? 
                      'Content will be stored unencrypted on the server' : 
                      passwordValue ? 
                        'Password-based encryption, secure as your password' :
                        'Securely encrypted with a strong random key'
                    }
                  </span>
                </div>
              </div>
            </div>
            
            {/* Show password field only if E2E encryption is selected */}
            {isE2EEncrypted && (
              <div className="mt-4">
                <div className="flex items-center mb-1">
                  <label htmlFor="password" className="block text-sm font-medium">
                    Password
                  </label>
                  <Tooltip 
                    content={
                      <div className="p-1 max-w-xs">
                        <p className="mb-1">
                          <strong>Password-based encryption:</strong> You'll need to remember this password to decrypt your content later.
                        </p>
                        <p className="mb-1">
                          <strong>Key-based encryption:</strong> Leave empty to use a secure random key (shared in the URL).
                        </p>
                        <p className="text-xs mt-2">
                          The server never receives your password or key - all encryption happens in your browser.
                        </p>
                      </div>
                    }
                    position="top"
                  >
                    <span className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold cursor-help">?</span>
                  </Tooltip>
                </div>
                
                <div className="relative">
                  <input
                    type="password"
                    id="password"
                    name="password"
                    autoComplete="new-password"
                    placeholder={!passwordValue && !isE2EEncrypted ? 
                      "Enter password or leave empty for key protection" : 
                      passwordValue ? 
                        "Your encryption password" :
                        "Leave empty to use a secure random key"
                    }
                    className={`w-full rounded-md border px-3 py-2 bg-background text-foreground pr-10 ${
                      passwordValue ? 'border-green-400' : 'border-input'
                    }`}
                    value={passwordValue}
                    onChange={(e) => {
                      // Update state with the new password value
                      setPasswordValue(e.target.value);
                      
                      // If we have an actual value, update security method to password
                      if (e.target.value.trim().length > 0) {
                        setSecurityMethod('password');
                      }
                    }}
                  />
                  
                  {/* Security indicator icon */}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {passwordValue ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    )}
                  </div>
                </div>
                
                {/* Helper text based on current selection */}
                <p className="text-xs mt-1 text-muted-foreground">
                  {passwordValue ? 
                    "This password will be required to decrypt your content later." : 
                    "A secure random key will be included in the URL for decryption."
                  }
                </p>
                
                {/* Password strength meter - only show if password is entered */}
                {passwordValue && (
                  <PasswordStrengthMeter password={passwordValue} />
                )}
              </div>
            )}
            
            <div className="space-y-4 mt-4">
              {/* Security options section */}
              <div className="bg-amber-50/80 dark:bg-blue-900/20 border border-amber-200/80 dark:border-blue-800 rounded-lg p-3 shadow-sm">
                <h3 className="text-sm font-semibold text-amber-900 dark:text-blue-300 mb-2">Security Options</h3>
                
                {/* Burn after reading option */}
                <div className="flex items-start mb-3">
                  <div className="flex h-5 items-center">
                    <input
                      type="checkbox"
                      id="burnAfterReading"
                      name="burnAfterReading"
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary dark:text-primary focus:ring-primary dark:focus:ring-primary focus:ring-offset-0 bg-white dark:bg-gray-800 checked:bg-primary dark:checked:bg-primary form-checkbox"
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label htmlFor="burnAfterReading" className="font-medium text-slate-700 dark:text-gray-300">
                      Burn after reading
                    </label>
                    <p className="text-slate-500 dark:text-gray-400 text-xs mt-0.5">
                      Content will be permanently deleted after first view
                    </p>
                  </div>
                </div>
                
                {/* Expiration options */}
                <div className="flex items-start">
                  <div className="flex h-5 items-center">
                    <input
                      type="checkbox"
                      id="enableViewLimit"
                      name="enableViewLimit"
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary dark:text-primary focus:ring-primary dark:focus:ring-primary focus:ring-offset-0 bg-white dark:bg-gray-800 checked:bg-primary dark:checked:bg-primary form-checkbox"
                      onChange={(e) => {
                        if (typeof document !== 'undefined') {
                          const viewLimitInput = document.getElementById('viewLimit') as HTMLInputElement;
                          if (viewLimitInput) {
                            viewLimitInput.disabled = !e.target.checked;
                            if (e.target.checked) {
                              viewLimitInput.focus();
                            }
                          }
                        }
                      }}
                    />
                  </div>
                  <div className="ml-3 text-sm flex-grow">
                    <label htmlFor="enableViewLimit" className="font-medium text-slate-700 dark:text-gray-300">
                      Limit number of views
                    </label>
                    <div className="flex items-center mt-1">
                      <input 
                        type="number" 
                        id="viewLimit" 
                        name="viewLimit" 
                        min="1" 
                        max="100" 
                        defaultValue="1" 
                        disabled
                        className="w-16 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" 
                      />
                        <label htmlFor="viewLimit" className="ml-2 text-xs text-slate-500 dark:text-gray-400">
                          views before expiration
                        </label>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Hidden field to maintain compatibility with the form submission */}
              <input
                type="hidden"
                id="e2eEncryption"
                name="e2eEncryption"
                value={isE2EEncrypted ? "on" : "off"}
                readOnly
              />
              
              {/* Hidden field for view limit */}
              <input
                type="hidden"
                id="viewLimitEnabled"
                name="viewLimitEnabled"
                value="false"
                ref={(el) => {
                  if (el && typeof document !== 'undefined') {
                    const enableViewLimit = document.getElementById('enableViewLimit') as HTMLInputElement;
                    if (enableViewLimit) {
                      el.value = enableViewLimit.checked ? "true" : "false";
                    }
                  }
                }}
                readOnly
              />
              
              {/* Encryption/Security notice */}
              {isE2EEncrypted ? (
                <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 p-3 rounded-md">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 7.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm text-blue-800 dark:text-blue-200">
                        <strong>Enhanced Privacy:</strong> Your content will be encrypted before being sent to the server.
                        {typeof document !== 'undefined' && (document.getElementById('password') as HTMLInputElement)?.value ? 
                          " You'll need the password to decrypt it." : 
                          " Only people with the complete URL can decrypt it."
                        }
                        {" The server never sees the original content."}
                      </p>
                    </div>
                  </div>
                </div>
              ) : passwordValue ? (
                <div className="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 p-3 rounded-md">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        <strong>Legacy Password Protection:</strong> You're using server-side password protection. 
                        For better security, consider using client-side encryption instead.
                        <span className="block mt-1 text-xs">This method will be deprecated in a future update.</span>
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            
            {/* Encryption progress bar - only show during encryption */}
            {isSubmitting && encryptionProgress !== null && (
              <div className="mt-4 mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">Encrypting content...</span>
                  <span className="text-sm font-medium">{encryptionProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-in-out" 
                    style={{ 
                      width: `${encryptionProgress}%`,
                      transitionProperty: "width",
                      transitionDuration: "300ms" 
                    }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {encryptionProgress === 0 ? "Preparing..." :
                   encryptionProgress < 15 ? "Generating encryption keys..." : 
                   encryptionProgress < 30 ? "Deriving secure key..." :
                   encryptionProgress < 50 ? "Processing data..." :
                   encryptionProgress < 75 ? "Applying encryption..." :
                   encryptionProgress < 95 ? "Finalizing encryption..." : 
                   "Securing your content..."}
                </p>
              </div>
            )}
            
            <CardFooter className="flex justify-between p-0 pt-4">
              <Button
                type="submit"
                variant="outline"
                disabled={isSubmitting}
              >
                {isSubmitting ?
                  (encryptionProgress !== null ?
                    (encryptionProgress < 30 ?
                      `Securing (${encryptionProgress}%)` :
                      `Encrypting (${encryptionProgress}%)`) :
                    'Creating...') :
                  'Create Paste'}
              </Button>
              <Button
                type="reset"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => {
                  setFormErrors({});
                  setIsE2EEncrypted(false);
                  setSecurityMethod('none');
                  setPasswordValue('');
                }}
              >
                Clear
              </Button>
            </CardFooter>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
