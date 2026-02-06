import { Paste } from '../../domain/models/paste';

export class HtmlRenderer {
  renderHomePage(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pasteriser Service</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
        <style>
          .container { max-width: 800px; margin: 0 auto; padding: 20px; }
          textarea { width: 100%; height: 300px; font-family: monospace; }
          .form-group { margin-bottom: 15px; }
          .form-group label { display: block; margin-bottom: 5px; }
          .button-group { display: flex; justify-content: space-between; }
          @media (prefers-color-scheme: dark) {
            select,
            option {
              background-color: #1c1f26;
              color: #f5f7fb;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Pasteriser Service</h1>
          <form id="paste-form">
            <div class="form-group">
              <label for="title">Title (optional):</label>
              <input type="text" id="title" name="title" placeholder="Untitled Paste">
            </div>
            <div class="form-group">
              <label for="content">Content:</label>
              <textarea id="content" name="content" required></textarea>
            </div>
            <div class="form-group">
              <label for="language">Language (optional):</label>
              <select id="language" name="language">
                <option value="">Plain Text</option>
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="html">HTML</option>
                <option value="css">CSS</option>
                <option value="typescript">TypeScript</option>
                <option value="json">JSON</option>
                <option value="markdown">Markdown</option>
              </select>
            </div>
            <div class="form-group">
              <label for="expiration">Expiration:</label>
              <select id="expiration" name="expiration">
                <option value="3600">1 hour</option>
                <option value="86400" selected>1 day</option>
                <option value="604800">1 week</option>
                <option value="2592000">30 days</option>
                <option value="31536000">1 year</option>
              </select>
            </div>
            <div class="form-group">
              <label for="visibility">Visibility:</label>
              <select id="visibility" name="visibility">
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div class="button-group">
              <button type="submit">Create Paste</button>
              <button type="reset">Clear</button>
            </div>
          </form>
          <div id="result" style="display: none; margin-top: 20px;">
            <h2>Paste Created!</h2>
            <p>Your paste is available at: <a id="paste-url" href="#"></a></p>
          </div>
        </div>
        <script>
          document.getElementById('paste-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const title = form.title.value;
            const content = form.content.value;
            const language = form.language.value;
            const expiration = parseInt(form.expiration.value, 10);
            const visibility = form.visibility.value;
            
            try {
              const response = await fetch('/pastes', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  title,
                  content,
                  language,
                  expiration,
                  visibility,
                }),
              });
              
              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error.message || 'Failed to create paste');
              }
              
              const result = await response.json();
              const resultDiv = document.getElementById('result');
              const pasteUrl = document.getElementById('paste-url');
              
              pasteUrl.href = result.url;
              pasteUrl.textContent = result.url;
              resultDiv.style.display = 'block';
            } catch (error) {
              alert('Error: ' + error.message);
            }
          });
        </script>
      </body>
      </html>
    `;
  }

  renderViewPage(paste: Paste): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${paste.getTitle() || 'Untitled Paste'}</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js"></script>
        <style>
          .container { max-width: 800px; margin: 0 auto; padding: 20px; }
          .metadata { margin-bottom: 20px; font-size: 0.9em; color: #666; }
          .content { background: #f8f8f8; padding: 15px; border-radius: 5px; overflow-x: auto; }
          pre { margin: 0; }
          code { font-family: 'Fira Code', monospace; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${paste.getTitle() || 'Untitled Paste'}</h1>
          <div class="metadata">
            <p>Created: ${paste.getCreatedAt().toLocaleString()}</p>
            <p>Expires: ${paste.getExpiresAt().toLocaleString()}</p>
            ${paste.getLanguage() ? `<p>Language: ${paste.getLanguage()}</p>` : ''}
          </div>
          <div class="content">
            <pre><code class="${paste.getLanguage() || 'plaintext'}">${this.escapeHtml(paste.getContent())}</code></pre>
          </div>
          <div style="margin-top: 20px;">
            <a href="/" class="button">Create New Paste</a>
          </div>
        </div>
        <script>
          document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('pre code').forEach((block) => {
              hljs.highlightElement(block);
            });
          });
        </script>
      </body>
      </html>
    `;
  }

  renderNotFoundPage(): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Paste Not Found</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
        <style>
          .container { max-width: 800px; margin: 0 auto; padding: 20px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Paste Not Found</h1>
          <p>The paste you are looking for does not exist or has expired.</p>
          <a href="/" class="button">Create New Paste</a>
        </div>
      </body>
      </html>
    `;
  }

  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
