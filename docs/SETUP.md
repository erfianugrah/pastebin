# Pastebin Project Setup Guide

This guide will walk you through the steps to set up and run the Pastebin application locally.

## Prerequisites

- Node.js (v16+)
- npm or yarn
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account

## Project Structure

The application follows a Domain-Driven Design architecture and consists of two main parts:

1. **Cloudflare Worker** - Backend API and server logic (in `/src`)
2. **Astro UI** - Frontend built with Astro and shadcn/ui (in `/astro`)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <repository-url>
cd pastebin
```

### 2. Install Dependencies

```bash
# Install main project dependencies
npm install

# Install Astro UI dependencies
cd astro
npm install
cd ..
```

### 3. Configure Cloudflare KV Namespace

Create a KV namespace for storing pastes:

```bash
wrangler kv:namespace create PASTES
```

This will output a namespace ID. Update the `wrangler.jsonc` file with your KV namespace ID:

```jsonc
{
  // ...
  "kv_namespaces": [
    {
      "binding": "PASTES",
      "id": "your-namespace-id",
      "preview_id": "your-preview-namespace-id"
    }
  ],
  // ...
}
```

### 4. Development

Start the development server with both the Worker API and Astro UI:

```bash
npm run dev:all
```

This will:
- Start the Astro UI at http://localhost:3000
- Start the Cloudflare Worker at http://localhost:8787

During development, you can also run each part separately:

```bash
# Run only the Astro UI development server
npm run dev:ui

# Run only the Cloudflare Worker
npm run dev
```

### 5. Building for Production

Build the project for production:

```bash
npm run build
```

This will:
1. Build the Astro UI to static files in `/astro/dist`
2. Configure the Worker to serve these files via the ASSETS binding

### 6. Deployment

Deploy to Cloudflare:

```bash
npm run deploy
```

## Project Commands

- `npm run dev:all` - Start both UI and Worker development servers
- `npm run dev:ui` - Start only the Astro UI development server
- `npm run dev` - Start only the Cloudflare Worker
- `npm run build` - Build both UI and Worker for production
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint
- `npm run check` - Run TypeScript typechecking

## Development Workflow

1. Make changes to the UI in the `/astro` directory
2. Make changes to the API in the `/src` directory
3. Test your changes using the development servers
4. Build and deploy when ready

## Troubleshooting

### KV Namespace Issues

If you encounter issues with the KV namespace, make sure:
- The namespace ID is correctly set in `wrangler.jsonc`
- You have permission to use the namespace in your Cloudflare account

### UI/API Integration Issues

When making changes to both the API and UI:
- Ensure API endpoints match what the UI expects
- Check that content types are set correctly (application/json for API responses)
- Verify CORS headers if testing UI and API on separate ports