# Pastebin Architecture Documentation

This document provides a detailed overview of the pastebin application architecture, which follows Domain-Driven Design (DDD) principles to maintain a clean separation of concerns.

## Architectural Overview

The application is structured in four primary layers:

1. **Domain Layer**: Core business logic and entities
2. **Application Layer**: Use cases and application orchestration
3. **Infrastructure Layer**: Technical capabilities and external services
4. **Interface Layer**: User interfaces and API endpoints

## Domain Layer

The domain layer contains the core business logic and rules of the application, independent of any external concerns.

### Core Models

- **Paste**: The central entity representing a user's text/code snippet
  ```typescript
  export class Paste {
    constructor(
      private readonly id: PasteId,
      private readonly content: string,
      private readonly createdAt: Date,
      private readonly expirationPolicy: ExpirationPolicy,
      private readonly title?: string,
      private readonly language?: string,
      private readonly visibility: Visibility = 'public',
      private readonly passwordHash?: string,
      private readonly burnAfterReading: boolean = false,
      private readonly readCount: number = 0,
    ) {}
    
    // Methods for accessing and managing paste data
  }
  ```

- **Value Objects**:
  - `PasteId`: Unique identifier for pastes
  - `ExpirationPolicy`: Encapsulates expiration rules
  - `Visibility`: Enum for paste visibility options ("public" or "private")

### Domain Services

- **ExpirationService**: Handles paste expiration policies
- **UniqueIdService**: Generates unique identifiers for pastes

### Repository Interfaces

- **PasteRepository**: Interface for paste storage operations
  ```typescript
  export interface PasteRepository {
    save(paste: Paste): Promise<void>;
    findById(id: PasteId): Promise<Paste | null>;
    delete(id: PasteId): Promise<boolean>;
    findRecentPublic(limit: number): Promise<Paste[]>;
  }
  ```

## Application Layer

The application layer coordinates the domain objects to perform use cases and application logic.

### Commands

- **CreatePasteCommand**: Handles paste creation
  ```typescript
  export class CreatePasteCommand {
    constructor(
      private readonly repository: PasteRepository,
      private readonly idService: UniqueIdService,
      private readonly expirationService: ExpirationService,
      private readonly baseUrl: string,
    ) {}
    
    async execute(params: CreatePasteParams): Promise<CreatePasteResult>
  }
  ```

### Queries

- **GetPasteQuery**: Retrieves pastes by ID
  ```typescript
  export class GetPasteQuery {
    constructor(private readonly repository: PasteRepository) {}
    
    async execute(id: string): Promise<Paste | null>
    async executeSummary(id: string): Promise<{ paste: Paste, requiresPassword: boolean } | null>
  }
  ```
  
- **AccessProtectedPasteQuery**: Handles authentication for password-protected pastes

### Factories

- **PasteFactory**: Creates paste entities from raw data
  ```typescript
  export class PasteFactory {
    static fromData(data: PasteData): Paste
  }
  ```

## Infrastructure Layer

The infrastructure layer implements technical capabilities required by the domain and application layers.

### Storage

- **KVPasteRepository**: Implementation of the PasteRepository using Cloudflare KV
  ```typescript
  export class KVPasteRepository implements PasteRepository {
    constructor(
      private readonly kv: KVNamespace,
      private readonly logger: Logger,
    ) {}
    
    // Implementation of PasteRepository methods
  }
  ```

### Logging

- **Logger**: Built on Pino with Cloudflare Workers integration
  ```typescript
  export class Logger {
    constructor(configService: ConfigurationService, env?: Env) {
      // Initialize Pino logger with Cloudflare-specific settings
    }
    
    // Logging methods and context management
  }
  ```

### Configuration

- **ConfigurationService**: Manages application configuration with Zod validation
  ```typescript
  export class ConfigurationService {
    private config: Config;

    constructor(customConfig: Partial<Config> = {}) {
      // Merge default config with custom config
      const mergedConfig = this.mergeConfigs(defaultConfig, customConfig);
      
      // Validate config
      this.config = ConfigSchema.parse(mergedConfig);
    }
    
    // Methods to access configuration
  }
  ```

### Security

- **RateLimit**: Implements request rate limiting
- **AppError**: Centralized error handling

### Caching

- **CacheControl**: Manages HTTP caching headers

### Analytics

- **Analytics**: Tracks user activity and system events

## Interface Layer

The interface layer handles user interaction with the system.

### API

- **ApiHandlers**: HTTP request handlers for the API
  ```typescript
  export class ApiHandlers {
    constructor(
      private readonly createPasteCommand: CreatePasteCommand,
      private readonly getPasteQuery: GetPasteQuery,
      private readonly accessProtectedPasteQuery: AccessProtectedPasteQuery,
      private readonly configService: ConfigurationService,
      private readonly logger: Logger,
      private readonly env: Env,
    ) {}
    
    // API endpoint handlers
  }
  ```

- **ApiMiddleware**: Cross-cutting concerns for API requests (CORS, headers)

### UI

- **Astro Components**: Static site generation for frontend
- **React Components**: Interactive UI elements
  - PasteForm: Form for creating pastes
  - CodeViewer: Syntax-highlighted code display

## Request Flow

1. HTTP request received by Cloudflare Worker
2. Request routed by path pattern in `index.ts`
3. Rate limiting applied if necessary
4. Request handled by appropriate API handler
5. Command/Query executed to perform business logic
6. Repository operations performed against KV storage
7. Response formatted and returned to the client
8. For UI requests, Astro-generated HTML served with client-side JavaScript for interactivity

## Directory Structure

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
│   ├── services/      # Infrastructure services
│   └── storage/       # Storage implementations
│
├── interfaces/        # User interfaces
│   ├── api/           # API handlers and middleware
│   └── ui/            # UI components and templates
│
├── types.ts           # Type definitions
└── index.ts          # Application entry point
```

## Deployment Architecture

The application is deployed as a Cloudflare Worker with the following resources:

- **Worker**: Runs the server-side code
- **KV Namespace**: Stores paste data with TTL-based expiration
- **Assets**: Serves the Astro-generated static files

## Future Architectural Improvements

1. **Authentication & Authorization**: User accounts and role-based access control
2. **WebSockets**: Real-time collaborative editing
3. **Durable Objects**: Consistency for concurrent operations
4. **R2 Storage**: For larger paste sizes and binary content
5. **Analytics Dashboard**: Advanced usage statistics
6. **Distributed Tracing**: Enhanced observability
7. **Dark Mode**: Theme switching with persistent preferences