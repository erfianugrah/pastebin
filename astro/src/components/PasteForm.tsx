import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';
import { toast } from './ui/toast';
import { generateEncryptionKey, encryptData, deriveKeyFromPassword } from '../lib/crypto';

export default function PasteForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{[key: string]: string}>({});
  const [result, setResult] = useState<{id: string, url: string, encryptionKey?: string} | null>(null);
  const [isE2EEncrypted, setIsE2EEncrypted] = useState(false);
  
  const validateForm = (formData: FormData) => {
    const errors: {[key: string]: string} = {};
    
    // Validate content
    const content = formData.get('content') as string;
    if (!content || content.trim().length === 0) {
      errors.content = 'Content is required';
    } else if (content.length > 25 * 1024 * 1024) { // 25MB
      errors.content = 'Content is too large (max 25MB)';
    } else if (content.length > 5 * 1024 * 1024) { // 5MB warning
      console.warn('Large paste detected:', Math.floor(content.length / (1024 * 1024)), 'MB');
    }
    
    // Validate title
    const title = formData.get('title') as string;
    if (title && title.length > 100) {
      errors.title = 'Title is too long (max 100 characters)';
    }
    
    return errors;
  };
  
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setFormErrors({});
    
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
      
      let encryptedContent = content;
      let encryptionKey: string | undefined;
      let passwordHash: string | undefined;
      
      // Handle client-side encryption (if private or e2e encryption is selected)
      if (e2eEncryption || (visibility === 'private' && isE2EEncrypted)) {
        try {
          // Generate a random encryption key
          encryptionKey = generateEncryptionKey();
          console.log('Generated encryption key');
          
          // Encrypt the content with this key
          encryptedContent = await encryptData(content, encryptionKey);
          console.log('Content encrypted successfully');
        } catch (error) {
          console.error('Encryption error:', error);
          throw new Error('Failed to encrypt content. Please try again.');
        }
      }
      
      // Handle password protection with encryption
      if (password) {
        if (e2eEncryption || (visibility === 'private' && isE2EEncrypted)) {
          try {
            // If we're doing E2E encryption already, we need to protect the encryption key with the password
            // We don't need to send the password to the server, just encrypt the key with it
            const { key: derivedKey, salt } = await deriveKeyFromPassword(password);
            
            // Encrypt the original encryption key with the password-derived key
            const encryptedKey = await encryptData(encryptionKey || '', derivedKey);
            
            // Store the salt and encrypted key as the "password hash" (overloading the field)
            // Format: salt:encryptedKey
            passwordHash = `${salt}:${encryptedKey}`;
          } catch (error) {
            console.error('Password encryption error:', error);
            throw new Error('Failed to process password encryption. Please try again.');
          }
        } else {
          // Use server-side password checking - let the server handle the hashing
          passwordHash = password;
        }
      }
      
      // Log encryption status for debugging
      console.log('Creating paste:', {
        isEncrypted: !!(e2eEncryption || (visibility === 'private' && isE2EEncrypted)),
        contentLength: encryptedContent.length,
        hasPassword: !!passwordHash
      });

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
          isEncrypted: !!(e2eEncryption || (visibility === 'private' && isE2EEncrypted)),
        }),
      }).catch(fetchError => {
        console.error('Network error:', fetchError);
        throw new Error('Network error. Please check your connection and try again.');
      });
      
      if (!response.ok) {
        const errorData = await response.json() as { error?: { message?: string } };
        throw new Error(errorData.error?.message || 'Failed to create paste');
      }
      
      const data = await response.json() as { id: string; url: string };
      
      // If using client-side encryption, append the key to the URL fragment
      // The fragment is not sent to the server
      let resultUrl = data.url;
      if (e2eEncryption || (visibility === 'private' && isE2EEncrypted)) {
        resultUrl = `${data.url}#key=${encryptionKey}`;
      }
      
      setResult({
        id: data.id,
        url: resultUrl,
        encryptionKey: e2eEncryption || (visibility === 'private' && isE2EEncrypted) ? encryptionKey : undefined,
      });
      
      toast({
        message: 'Paste created successfully!',
        type: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        message: error instanceof Error ? error.message : 'Failed to create paste',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  }
  
  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Create New Paste</CardTitle>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="text-center p-4">
            <h2 className="text-xl font-bold mb-2">Paste Created!</h2>
            <p className="mb-4">Your paste is available at:</p>
            <div className="bg-muted p-2 rounded-md mb-4 overflow-x-auto">
              <a 
                href={result.url} 
                className="text-primary font-mono text-sm hover:underline"
                target="_blank" 
                rel="noopener noreferrer"
              >
                {result.url}
              </a>
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
                  <p className="text-sm text-yellow-800 dark:text-yellow-300">
                    Share the complete URL including the part after # to allow others to decrypt this paste.
                  </p>
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
                    <option value="html">HTML</option>
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
                    <option value="xml">XML</option>
                    <option value="yaml">YAML</option>
                    <option value="toml">TOML</option>
                    <option value="ini">INI</option>
                    <option value="csv">CSV</option>
                  </optgroup>
                  
                  {/* Infrastructure & DevOps */}
                  <optgroup label="Infrastructure & DevOps">
                    <option value="hcl">HCL (Terraform)</option>
                    <option value="dockerfile">Dockerfile</option>
                    <option value="bash">Bash</option>
                    <option value="shell">Shell</option>
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
                    // Enable E2E encryption by default when private is selected
                    if (e.target.value === 'private') {
                      setIsE2EEncrypted(true);
                    }
                  }}
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
                {isE2EEncrypted && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Private pastes use end-to-end encryption for maximum security
                  </p>
                )}
              </div>
              
              <div>
                <label htmlFor="password" className="block text-sm font-medium mb-1">
                  Password (optional)
                </label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  placeholder="Leave empty for no password"
                  className="w-full rounded-md border border-input px-3 py-2 bg-background text-foreground"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="burnAfterReading"
                  name="burnAfterReading"
                  className="rounded border-input h-4 w-4 accent-primary"
                />
                <label htmlFor="burnAfterReading" className="text-sm font-medium">
                  Burn after reading (paste will be deleted after first view)
                </label>
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="e2eEncryption"
                  name="e2eEncryption"
                  className="rounded border-input h-4 w-4 accent-primary"
                  checked={isE2EEncrypted}
                  onChange={(e) => setIsE2EEncrypted(e.target.checked)}
                />
                <label htmlFor="e2eEncryption" className="text-sm font-medium">
                  End-to-end encryption (content encrypted in your browser)
                </label>
              </div>
              
              {isE2EEncrypted && (
                <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 p-3 rounded-md mt-2">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Enhanced Privacy:</strong> Your content will be encrypted before being sent to the server.
                    Only people with the complete URL can decrypt it. The server never sees the original content.
                  </p>
                </div>
              )}
            </div>
            
            <CardFooter className="flex justify-between p-0 pt-4">
              <Button 
                type="submit" 
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Creating...' : 'Create Paste'}
              </Button>
              <Button 
                type="reset" 
                variant="outline"
                disabled={isSubmitting}
                onClick={() => {
                  setFormErrors({});
                  setIsE2EEncrypted(false);
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