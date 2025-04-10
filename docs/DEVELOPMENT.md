# Pastebin Development Guide

This guide will help you set up your development environment and provide guidance on contributing to the Pastebin project.

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm or yarn
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account

### Setting Up Your Development Environment

1. **Clone the repository**

```bash
git clone https://github.com/username/pastebin.git
cd pastebin
```

2. **Install dependencies**

```bash
# Install backend dependencies
npm install

# Install UI dependencies
cd astro
npm install
cd ..
```

3. **Configure Wrangler**

Create a KV namespace for local development:

```bash
wrangler kv:namespace create PASTES --preview
```

Update your `wrangler.jsonc` with the generated namespace ID:

```json
"kv_namespaces": [
  {
    "binding": "PASTES",
    "id": "your-namespace-id-here"
  }
]
```

4. **Create a `.dev.vars` file for local environment variables**

```
# Example .dev.vars file
LOG_LEVEL="debug"
```

### Development Workflow

#### Running the Development Servers

The project includes several npm scripts to streamline development:

```bash
# Start backend only (Cloudflare Worker)
npm run dev

# Start UI development server only (Astro)
npm run dev:ui

# Start both servers (recommended for full-stack development)
npm run dev:all
```

- Backend server runs at: http://localhost:8787
- Astro UI server runs at: http://localhost:3000

#### TypeScript Checking

Run TypeScript type checking without emitting files:

```bash
npm run check
```

#### Testing

Run the test suite:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Project Structure

### Backend (Cloudflare Worker)

The backend follows a Domain-Driven Design (DDD) approach:

```
src/
├── domain/            # Core business logic
│   ├── models/        # Domain entities and value objects
│   ├── repositories/  # Repository interfaces
│   └── services/      # Domain services
│
├── application/       # Application use cases
│   ├── commands/      # Command handlers
│   ├── queries/       # Query handlers
│   └── factories/     # Object factories
│
├── infrastructure/    # Technical capabilities
│   ├── analytics/     # Usage tracking
│   ├── caching/       # Cache control
│   ├── config/        # Configuration management
│   ├── errors/        # Error handling
│   ├── logging/       # Logging services
│   ├── security/      # Security controls
│   └── storage/       # Storage implementations
│
├── interfaces/        # User interfaces
│   ├── api/           # API handlers and middleware
│   └── ui/            # UI templates
│
├── index.ts           # Application entry point
└── types.ts           # Type definitions
```

### Frontend (Astro)

The frontend is built with Astro and React components:

```
astro/
├── public/            # Static assets
├── src/
│   ├── components/    # React components
│   │   ├── ui/        # shadcn/ui components 
│   │   └── ...        # Application-specific components
│   ├── layouts/       # Page layouts
│   └── pages/         # Astro pages
│       └── pastes/    # Paste-related pages
├── astro.config.mjs   # Astro configuration
└── tailwind.config.mjs # Tailwind CSS configuration
```

## Key Concepts

### Domain-Driven Design

- **Entities**: Core business objects with identity (e.g., `Paste`)
- **Value Objects**: Immutable objects without identity (e.g., `PasteId`, `ExpirationPolicy`)
- **Repositories**: Data access interfaces (e.g., `PasteRepository`)
- **Services**: Domain operations that don't belong to entities (e.g., `UniqueIdService`)

### Command Query Responsibility Segregation (CQRS)

- **Commands**: Operations that change state (e.g., `CreatePasteCommand`)
- **Queries**: Operations that read state (e.g., `GetPasteQuery`)

### Cloudflare Workers Concepts

- **Env**: Environment bindings (KV, Secrets, etc.)
- **ExecutionContext**: Context for handling requests
- **Headers/Request/Response**: Web standard objects

## Coding Guidelines

### TypeScript

- Use TypeScript's type system effectively
- Define interfaces for all data structures
- Use discriminated unions for complex types
- Avoid `any` when possible; use `unknown` instead

### Naming Conventions

- **Classes**: PascalCase (e.g., `PasteRepository`)
- **Interfaces**: PascalCase (e.g., `PasteData`)
- **Methods/Functions**: camelCase (e.g., `createPaste`)
- **Variables**: camelCase (e.g., `pasteId`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_CONTENT_SIZE`)

### Error Handling

- Use the `AppError` class for domain and application errors
- Always catch and handle errors in API handlers
- Log errors with appropriate context
- Return consistent error responses

### Testing

- Write unit tests for domain and application logic
- Test happy paths and edge cases
- Use mocks for external dependencies
- Follow the AAA pattern (Arrange, Act, Assert)

## Common Tasks

### Adding a New Feature

1. Define the domain model (if needed)
2. Implement the repository interface (if needed)
3. Create command/query for the feature
4. Implement the API handler
5. Update the UI components
6. Add tests

### Adding a New API Endpoint

1. Create a handler method in `ApiHandlers`
2. Add the route in `index.ts`
3. Update the API documentation

### Modifying the Database Schema

1. Update the domain model
2. Update the repository implementation
3. Ensure backward compatibility

## Deployment

### Staging

Deploy to the staging environment:

```bash
npm run deploy:staging
```

### Production

Deploy to the production environment:

```bash
npm run deploy:prod
```

## Troubleshooting

### Common Issues

#### KV Storage Issues

If you encounter KV storage issues:

```bash
# List KV namespaces
wrangler kv:namespace list

# Check your wrangler.jsonc configuration
```

#### Worker Deployment Issues

If deployment fails:

```bash
# Check your account configuration
wrangler whoami

# Try with verbose logging
wrangler deploy --verbose
```

#### Astro Build Issues

If Astro build fails:

```bash
# Clean the build directory
rm -rf astro/dist

# Run with verbose logging
cd astro && npm run build -- --verbose
```

### Debugging

- Use `console.log` for simple debugging
- Use structured logging with different log levels
- Check the Cloudflare Workers logs in the dashboard

## Getting Help

If you need assistance, please:

1. Check the documentation
2. Look for similar issues in the issue tracker
3. Ask for help in the project's communication channels