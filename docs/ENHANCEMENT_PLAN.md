# Pastebin Enhancement Plan

This document outlines the planned enhancements for the Pastebin application after initial deployment and testing. These improvements focus on security, user experience, performance, and monitoring.

## 1. Security & Production Readiness

### Rate Limiting Implementation

Rate limiting is critical to prevent abuse of the API and protect the service from excessive usage. We'll implement IP-based rate limiting using KV for tracking.

```typescript
// src/infrastructure/security/rateLimit.ts
export async function handleRateLimit(request: Request, env: Env): Promise<Response | null> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `ratelimit:${ip}`;
  const data = await env.PASTES.get(key);
  const now = Date.now();
  const windowSize = 60 * 1000; // 1 minute
  const limit = 30; // 30 requests per minute
  
  let count = 0;
  let resetTime = now + windowSize;
  
  if (data) {
    const parsed = JSON.parse(data);
    if (now < parsed.resetTime) {
      count = parsed.count;
      resetTime = parsed.resetTime;
    }
  }
  
  count++;
  await env.PASTES.put(key, JSON.stringify({ count, resetTime }), { expirationTtl: 60 });
  
  if (count > limit) {
    return new Response(
      JSON.stringify({
        error: { code: 'rate_limit_exceeded', message: 'Too many requests' }
      }),
      { 
        status: 429, 
        headers: { 'Retry-After': Math.ceil((resetTime - now) / 1000).toString() }
      }
    );
  }
  
  return null;
}
```

**Integration with Worker:**

```typescript
// Update src/index.ts to include rate limiting
// After CORS handling
const rateLimitResponse = await handleRateLimit(request, env);
if (rateLimitResponse) {
  return rateLimitResponse;
}
```

### Robust Error Handling

Creating a centralized error system improves user experience and debugging:

```typescript
// src/infrastructure/errors/AppError.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({
        error: {
          code: this.code,
          message: this.message,
          details: this.details,
        },
      }),
      {
        status: this.statusCode,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Error types
export const ValidationError = (message: string, details?: Record<string, any>) =>
  new AppError('validation_error', message, 400, details);

export const NotFoundError = (message: string) =>
  new AppError('not_found', message, 404);

export const RateLimitError = (message: string, retryAfter: number) =>
  new AppError('rate_limit_exceeded', message, 429, { retryAfter });
```

## 2. User Experience Enhancements

### Dark Mode Support

To support dark mode, we'll modify the Astro UI:

```typescript
// astro/src/components/ThemeProvider.tsx
import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
```

**Integration with Layout:**

```astro
// astro/src/layouts/Layout.astro
---
import { ThemeProvider } from '../components/ThemeProvider';
// ... other imports
---

<html lang="en">
  <head>
    <!-- ... head content -->
  </head>
  <body>
    <ThemeProvider client:load>
      <slot />
    </ThemeProvider>
  </body>
</html>
```

### Content Enhancements

We'll expand language support in the CodeViewer component and add line numbering:

```typescript
// Update CodeViewer.tsx to show line numbers
<div className="bg-muted p-4 rounded-md overflow-x-auto">
  <pre className={`language-${paste.language || 'plaintext'} relative`}>
    <div className="absolute left-0 top-0 bottom-0 pr-3 text-muted-foreground select-none border-r border-border">
      {paste.content.split('\n').map((_, i) => (
        <div key={i} className="text-right w-8">{i + 1}</div>
      ))}
    </div>
    <code className="pl-12" ref={codeRef}>{paste.content}</code>
  </pre>
</div>
```

## 3. Performance Optimization

### Caching Strategy

Implement caching to improve performance and reduce load:

```typescript
// Update API responses with caching headers
function addCacheHeaders(response: Response, maxAge: number = 3600): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${maxAge}`);
  headers.set('Vary', 'Accept');
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// Apply to paste retrieval
if (path.startsWith('/pastes/') && request.method === 'GET') {
  const response = await apiHandlers.handleGetPaste(request, pasteId);
  
  // Only cache successful responses
  if (response.status === 200) {
    return addCacheHeaders(response);
  }
  
  return response;
}
```

### Code Splitting for UI

Update Astro configuration for better code splitting:

```javascript
// astro/astro.config.mjs
export default defineConfig({
  output: 'static',
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    react(),
  ],
  build: {
    assets: 'assets',
    // Improve code splitting
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'highlight': ['highlight.js'],
            'react-vendor': ['react', 'react-dom'],
            'ui': [
              './src/components/ui/button.tsx',
              './src/components/ui/card.tsx',
              './src/components/ui/textarea.tsx',
            ],
          }
        }
      }
    }
  }
});
```

## 4. Monitoring & Analytics

### Basic Analytics Implementation

```typescript
// src/infrastructure/analytics/analytics.ts
export interface AnalyticsEvent {
  type: string;
  data: Record<string, any>;
  timestamp: number;
}

export class Analytics {
  constructor(private readonly kv: KVNamespace) {}

  async trackEvent(type: string, data: Record<string, any>): Promise<void> {
    const event: AnalyticsEvent = {
      type,
      data,
      timestamp: Date.now(),
    };

    // Use a date-based key to easily query events by date
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const key = `analytics:${date}:${crypto.randomUUID()}`;
    
    await this.kv.put(key, JSON.stringify(event), {
      expirationTtl: 60 * 60 * 24 * 30, // 30 days
    });
  }

  async getDailyStats(date: string): Promise<Record<string, number>> {
    const { keys } = await this.kv.list({ prefix: `analytics:${date}:` });
    
    const stats: Record<string, number> = {};
    
    for (const key of keys) {
      const eventData = await this.kv.get(key.name);
      if (eventData) {
        const event: AnalyticsEvent = JSON.parse(eventData);
        stats[event.type] = (stats[event.type] || 0) + 1;
      }
    }
    
    return stats;
  }
}
```

**Usage:**

```typescript
// In create paste handler
await analytics.trackEvent('paste_created', { 
  id: paste.getId().toString(),
  language: paste.getLanguage(),
  size: paste.getContent().length,
});

// In view paste handler
await analytics.trackEvent('paste_viewed', { 
  id: paste.getId().toString(),
});
```

## 5. Implementation Plan

### Phase 1: Security (Week 1)
- Implement rate limiting
- Add centralized error handling
- Add input validation and sanitization

### Phase 2: User Experience (Week 2)
- Add dark mode support
- Implement line numbering
- Expand language support

### Phase 3: Performance (Week 3)
- Implement caching strategy
- Optimize asset loading
- Improve code splitting

### Phase 4: Monitoring (Week 4)
- Add basic analytics
- Implement error tracking
- Set up performance monitoring

This phased approach addresses the most critical enhancements first, with security taking priority, followed by improvements to user experience, performance, and monitoring capabilities.

## Future Considerations

After implementing these enhancements, consider these advanced features:

- **Password Protection**: Allow pastes to be protected with a password
- **Custom URLs**: Let users choose custom IDs for pastes
- **Burn After Reading**: Self-destructing pastes that are deleted after first view
- **API Keys**: For programmatic access with higher rate limits
- **User Accounts**: For managing paste collections
- **Link Shortening**: Integrated URL shortening for paste links