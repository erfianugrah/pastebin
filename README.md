# Pastebin Service

A modern, secure pastebin service built on Cloudflare Workers with Domain-Driven Design principles. Create and share code snippets or text with customizable expiration, privacy settings, and syntax highlighting.

## Features

- **Basic Paste Functionality**
  - Create and view text pastes with customizable content
  - Syntax highlighting for 20+ programming languages
  - Custom expiration times (1 hour to 1 year)
  - Public and private visibility options
  
- **Security & Privacy**
  - Password protection for sensitive pastes
  - "Burn after reading" self-destructing pastes
  - Rate limiting to prevent abuse
  
- **Usability**
  - Raw view for easy copying/embedding
  - Line numbers for code readability
  - Responsive UI that works on mobile and desktop
  - Copy to clipboard functionality

- **Infrastructure**
  - Comprehensive logging system
  - Error handling and monitoring
  - Analytics tracking for usage insights
  - Caching for performance optimization

## Technology Stack

- **Backend**
  - Cloudflare Workers: Serverless edge computing
  - TypeScript: Strongly typed JavaScript
  - Zod: Runtime schema validation
  - Pino: Structured logging
  - Cloudflare KV: Key-value storage

- **Frontend**
  - Astro: Static site generator
  - React: UI components
  - Tailwind CSS: Utility-first styling
  - shadcn/ui: Accessible UI components

## Architecture

This project follows Domain-Driven Design principles with a clear separation of concerns:

- **Domain Layer**: Core business logic and entities
- **Application Layer**: Use cases and application logic
- **Infrastructure Layer**: External concerns (storage, logging)
- **Interface Layer**: User interfaces (API, UI)

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm or yarn
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account

### Installation

```bash
# Clone the repository
git clone https://github.com/username/pastebin.git
cd pastebin

# Install dependencies
npm install
```

### Development

The project includes several npm scripts to help with development:

```bash
# Start development server for backend
npm run dev

# Start UI development server
npm run dev:ui

# Start both backend and UI servers concurrently
npm run dev:all

# Run TypeScript type checking
npm run check

# Run tests
npm test
```

### Configuration

The application is configured through `wrangler.jsonc`. You need to:

1. Create a KV namespace for paste storage
2. Update the `wrangler.jsonc` with your KV namespace ID
3. Configure any custom domains if needed

### Deployment

Deploy to Cloudflare Workers:

```bash
# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:prod
```

## Documentation

- [API Documentation](./docs/API.md) - API endpoints and usage
- [Development Guide](./docs/DEVELOPMENT.md) - Getting started with development
- [Architecture](./docs/ARCHITECTURE.md) - Detailed architecture overview
- [Next Steps](./docs/NEXT_STEPS.md) - Future development plans
- [Features](./docs/FEATURES.md) - Detailed feature documentation

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT