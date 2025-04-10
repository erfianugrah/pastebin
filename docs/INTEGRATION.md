# Astro and Cloudflare Workers Integration Guide

This document outlines how to integrate the Astro frontend with the Cloudflare Workers backend for the Pastebin application.

## Architecture Overview

The application has two main parts:
1. **Astro Frontend**: Generates static HTML/CSS/JS for the UI
2. **Cloudflare Worker**: Handles API requests and serves the static assets

```
┌─────────────────┐     ┌───────────────────┐
│                 │     │                   │
│  Astro Frontend │────>│ Static Assets     │
│                 │     │ (./astro/dist)    │
└─────────────────┘     └─────────┬─────────┘
                                  │
                                  ▼
┌─────────────────┐     ┌───────────────────┐
│                 │     │                   │
│  Worker Backend │<───>│ ASSETS Binding    │
│                 │     │                   │
└─────────────────┘     └───────────────────┘
```

## Setup Process

### 1. Initialize Astro Project

```bash
# Create the Astro project
mkdir -p astro
cd astro
npm create astro@latest .

# Configure Astro with TypeScript and Tailwind
# Select: Yes to TypeScript (strict)
# Select: Yes to Tailwind CSS
```

### 2. Install shadcn/ui

```bash
# Add React integration (required for shadcn/ui)
npm install @astrojs/react react react-dom
npm install -D tailwindcss @astrojs/tailwind clsx tailwind-merge

# Install shadcn CLI and initialize
npx shadcn-ui@latest init
```

### 3. Configure astro.config.mjs

```js
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

export default defineConfig({
  output: 'static',
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    react(),
  ],
  // Keep the build output clean for CF Workers
  build: {
    assets: 'assets',
  },
});
```

### 4. Update Wrangler Configuration

Update the `wrangler.jsonc` file to point to the Astro build output:

```jsonc
{
  // ... existing config
  "assets": {
    "binding": "ASSETS",
    "directory": "./astro/dist"
  }
}
```

### 5. Create Build Scripts

Update the root `package.json` to include build scripts:

```json
{
  "scripts": {
    "build:ui": "cd astro && npm run build",
    "dev:ui": "cd astro && npm run dev -- --port 3000",
    "build": "npm run build:ui && wrangler build",
    "deploy": "npm run build && wrangler deploy",
    "dev:worker": "wrangler dev",
    "dev": "concurrently \"npm run dev:ui\" \"npm run dev:worker\""
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

## Development Workflow

### Local Development

Run both the Astro development server and the Cloudflare Worker development server concurrently:

```bash
npm run dev
```

This will:
1. Start Astro dev server on port 3000 (UI)
2. Start Wrangler dev server on port 8787 (API)

During development:
- UI changes will be instantly visible at http://localhost:3000
- API requests from the UI will be proxied to http://localhost:8787/api/*

### Production Build

To build for production:

```bash
npm run build
```

This will:
1. Build the Astro frontend to `astro/dist`
2. Package the Worker with the ASSETS binding pointing to that directory

### Deployment

To deploy to Cloudflare:

```bash
npm run deploy
```

## API Integration

### Frontend API Calls

Use Astro's server-side capabilities to fetch data from the API:

```astro
---
// src/pages/pastes/[id].astro
export async function getStaticPaths() {
  return {
    fallback: true
  };
}

const { id } = Astro.params;
// Server-side fetch when rendering the page
const response = await fetch(`${import.meta.env.API_URL}/pastes/${id}`);
const paste = await response.json();
---

<Layout title={paste.title || 'Untitled Paste'}>
  <PasteViewer paste={paste} client:load />
</Layout>
```

### Client-Side API Calls

For client-side interactivity, use React components with fetch:

```jsx
// src/components/PasteForm.jsx
import { useState } from 'react';
import { Button } from './ui/button';

export function PasteForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  async function handleSubmit(e) {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const formData = new FormData(e.target);
      const response = await fetch('/pastes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.get('title'),
          content: formData.get('content'),
          // ...other fields
        }),
      });
      
      if (!response.ok) throw new Error('Failed to create paste');
      
      const result = await response.json();
      window.location.href = `/pastes/${result.id}`;
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  }
  
  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create Paste'}
      </Button>
    </form>
  );
}
```

## Handling Routes

Configure the Worker to properly handle all routes:

### Static Asset Routes

The Worker should serve static assets from the ASSETS binding:

```typescript
// For static asset requests (CSS, JS, images)
if (path.match(/\.(js|css|png|jpg|svg|ico)$/)) {
  return env.ASSETS.fetch(request);
}
```

### API Routes

API routes should be handled by the Worker:

```typescript
// For API requests
if (path.startsWith('/pastes')) {
  // Handle API requests as before
}
```

### HTML Routes (handled by Astro)

For all other routes, serve the appropriate HTML from the ASSETS binding:

```typescript
// For HTML routes (/, /pastes/:id)
// Let Astro's static HTML handle these
return env.ASSETS.fetch(request);
```

## Production Considerations

1. **Caching**: Configure proper caching headers for static assets
2. **API Rate Limiting**: Implement rate limiting for API endpoints
3. **Error Handling**: Add global error boundaries in React components
4. **Analytics**: Add analytics tracking to monitor usage
5. **Monitoring**: Set up Cloudflare Workers monitoring