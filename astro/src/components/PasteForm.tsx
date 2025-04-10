import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';

export default function PasteForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{[key: string]: string}>({});
  const [result, setResult] = useState<{id: string, url: string} | null>(null);
  
  const validateForm = (formData: FormData) => {
    const errors: {[key: string]: string} = {};
    
    // Validate content
    const content = formData.get('content') as string;
    if (!content || content.trim().length === 0) {
      errors.content = 'Content is required';
    } else if (content.length > 1024 * 1024) { // 1MB
      errors.content = 'Content is too large (max 1MB)';
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
      
      const response = await fetch('/pastes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.get('title'),
          content: formData.get('content'),
          language: formData.get('language'),
          expiration: parseInt(formData.get('expiration') as string, 10),
          visibility: formData.get('visibility'),
          password: formData.get('password') || undefined,
          burnAfterReading: formData.get('burnAfterReading') === 'on',
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json() as { error?: { message?: string } };
        throw new Error(errorData.error?.message || 'Failed to create paste');
      }
      
      const data = await response.json() as { id: string; url: string };
      setResult(data);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to create paste');
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
            <a 
              href={result.url} 
              className="text-primary hover:underline"
              target="_blank" 
              rel="noopener noreferrer"
            >
              {result.url}
            </a>
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
                className={`w-full rounded-md border ${formErrors.title ? 'border-destructive' : 'border-input'} px-3 py-2`}
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
                className={`font-mono ${formErrors.content ? 'border-destructive' : ''}`}
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
                  className="w-full rounded-md border border-input px-3 py-2"
                >
                  <option value="">Plain Text</option>
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python</option>
                  <option value="html">HTML</option>
                  <option value="css">CSS</option>
                  <option value="json">JSON</option>
                  <option value="markdown">Markdown</option>
                  <option value="ruby">Ruby</option>
                  <option value="go">Go</option>
                  <option value="rust">Rust</option>
                  <option value="java">Java</option>
                  <option value="c">C</option>
                  <option value="cpp">C++</option>
                  <option value="csharp">C#</option>
                  <option value="php">PHP</option>
                  <option value="shell">Shell</option>
                  <option value="sql">SQL</option>
                  <option value="yaml">YAML</option>
                  <option value="xml">XML</option>
                </select>
              </div>
              
              <div>
                <label htmlFor="expiration" className="block text-sm font-medium mb-1">
                  Expiration
                </label>
                <select
                  id="expiration"
                  name="expiration"
                  className="w-full rounded-md border border-input px-3 py-2"
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
                  className="w-full rounded-md border border-input px-3 py-2"
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
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
                  className="w-full rounded-md border border-input px-3 py-2"
                />
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="burnAfterReading"
                name="burnAfterReading"
                className="rounded border-input h-4 w-4"
              />
              <label htmlFor="burnAfterReading" className="text-sm font-medium">
                Burn after reading (paste will be deleted after first view)
              </label>
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
                onClick={() => setFormErrors({})}
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