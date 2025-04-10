# UI Architecture with Astro and shadcn/ui

## Overview

We'll implement the UI layer using Astro with shadcn/ui components, which provides several advantages:

1. **Performance**: Astro's "islands architecture" sends minimal JavaScript to the client
2. **Component Quality**: shadcn/ui provides high-quality, accessible, and customizable components
3. **Developer Experience**: TypeScript integration and excellent DX
4. **Asset Optimization**: Built-in optimization for faster loading
5. **Styling**: Tailwind CSS for consistent styling with shadcn components

## Implementation Plan

### 1. Project Structure

```
pastebin/
├── astro/                  # Astro UI project
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── layouts/        # Page layouts
│   │   ├── pages/          # Route pages
│   │   │   ├── index.astro # Home/create page
│   │   │   └── [id].astro  # Paste view page
│   │   └── utils/          # UI utilities
│   ├── public/             # Static assets
│   ├── astro.config.mjs    # Astro config
│   └── tailwind.config.cjs # Tailwind config
└── src/                    # Worker code (existing structure)
```

### 2. Integration Strategy

1. **Build Process**:
   - Astro builds static assets to the `dist` directory
   - Cloudflare Worker uses these assets via ASSETS binding

2. **API Communication**:
   - Astro pages make fetch requests to the Worker API endpoints
   - Server-side rendering for initial page load
   - Client-side hydration for interactive components only

3. **Asset Binding Configuration**:
   - Update `wrangler.jsonc` to point ASSETS binding to `./astro/dist`

### 3. Environment Setup

```bash
# Install Astro in a subdirectory
mkdir -p astro
cd astro

# Initialize Astro with TypeScript and Tailwind
npm create astro@latest -- --template basics --typescript strict --tailwind

# Install shadcn/ui dependencies
npm install @astrojs/react
npm install react react-dom
npm install -D tailwindcss @astrojs/tailwind clsx tailwind-merge lucide-react

# Set up shadcn CLI
npx shadcn-ui@latest init

# Add essential components
npx shadcn-ui@latest add button card textarea select form input toast
```

### 4. Wrangler Configuration

```jsonc
// wrangler.jsonc
{
  // Existing config...
  "assets": {
    "binding": "ASSETS",
    "directory": "./astro/dist"
  }
}
```

### 5. Build Process

Add to the root `package.json`:

```json
"scripts": {
  // Existing scripts...
  "build:ui": "cd astro && npm run build",
  "dev:ui": "cd astro && npm run dev",
  "build": "npm run build:ui && wrangler build",
  "dev:all": "concurrently \"npm run dev:ui\" \"npm run dev\""
}
```

### 6. Key Components

1. **HomePage**: Create paste form with syntax highlighting editor
2. **ViewPage**: Paste viewer with syntax highlighting
3. **PasteForm**: Component for creating new pastes
4. **CodeViewer**: Component for displaying code with syntax highlighting

### 7. Styling Approach

- Use Tailwind CSS for consistent styling
- Create theme variables that match shadcn/ui's design system
- Implement responsive design with mobile-first approach
- Support dark/light mode toggle

## Benefits

1. **Enhanced User Experience**: Professional UI components with accessibility built-in
2. **Performance**: Only hydrate interactive components, keeping most of the site static
3. **Maintainability**: Clear separation between UI and API logic
4. **Scalability**: Easy to add new UI features without touching the core Worker logic

## Implementation Notes

- API endpoints will remain in the Worker, with the UI making fetch requests to them
- For SEO and performance, use Astro's server-side rendering for initial page loads
- Use TypeScript throughout for type safety between UI and API
- Implement proper error handling with toast notifications
- Add analytics tracking for paste creation and views