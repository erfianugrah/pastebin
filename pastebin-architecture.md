# Pastebin App Architecture

## Domain-Driven Design Architecture

### Core Domain
- **Paste**: Central entity of the application
  - Properties: id, content, title, expiration, createdAt, language, visibility
  - Value Objects: PasteId, ExpirationPolicy
  - Repository: PasteRepository

### Bounded Contexts
1. **Paste Creation Context**
   - Commands: CreatePasteCommand
   - Factories: PasteFactory
   - Services: UniqueIdService

2. **Paste Retrieval Context**
   - Queries: GetPasteQuery
   - Services: PasteViewService

3. **Paste Management Context**
   - Commands: DeletePasteCommand, UpdatePasteCommand
   - Services: ExpirationService

## Technical Architecture

### Storage Layer
- **Cloudflare KV**: Primary storage for pastes
  - Key: paste ID
  - Value: serialized paste data
  - Secondary indexes for lookup by expiration

### API Design
- **Command Pattern**: Separates request processing from business logic
  - CreatePasteCommand
  - GetPasteCommand
  - DeletePasteCommand
  - ListPastesCommand

### Configuration
- **Zod Schema**:
```typescript
const ConfigSchema = z.object({
  application: z.object({
    name: z.string(),
    version: z.string(),
  }),
  storage: z.object({
    namespace: z.string(),
    expirationStrategy: z.enum(['ttl', 'explicit', 'hybrid']),
  }),
  security: z.object({
    rateLimit: z.number().optional(),
    allowedOrigins: z.array(z.string()).optional(),
  }),
  paste: z.object({
    maxSize: z.number(),
    defaultExpiration: z.number(),
    allowedLanguages: z.array(z.string()).optional(),
  }),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    pretty: z.boolean().optional(),
  }),
});
```

### Logging Strategy
- **Pino Logger**: Structured logging with Cloudflare Workers
  - Custom transport for Workers environment
  - Log contextual information with pastes
  - Performance metrics for operations

## Project Structure
```
src/
├── domain/
│   ├── models/
│   │   ├── paste.ts
│   │   └── valueObjects/
│   ├── repositories/
│   │   └── pasteRepository.ts
│   └── services/
│       ├── expirationService.ts
│       └── uniqueIdService.ts
├── application/
│   ├── commands/
│   │   ├── createPasteCommand.ts
│   │   ├── deletePasteCommand.ts
│   │   └── updatePasteCommand.ts
│   ├── queries/
│   │   └── getPasteQuery.ts
│   └── factories/
│       └── pasteFactory.ts
├── infrastructure/
│   ├── storage/
│   │   └── kvPasteRepository.ts
│   ├── logging/
│   │   └── pinoLogger.ts
│   └── config/
│       └── configurationService.ts
├── interfaces/
│   ├── api/
│   │   ├── handlers/
│   │   └── middleware/
│   └── ui/
│       └── public/
└── index.ts
```

## Worker Request Flow

1. HTTP request received by Worker
2. Request parsed by appropriate handler
3. Command/Query created from request data
4. Command/Query validated using Zod
5. Command/Query executed by command handler
6. Repository operations performed
7. Response created from command result
8. HTTP response returned

## Implementation Plan

### Phase 1: Foundation
- Setup project with Wrangler
- Implement domain models and configuration
- Basic KV repository implementation
- Core Pino logging setup

### Phase 2: Core Functionality
- Create paste command implementation
- Get paste query implementation
- Basic HTML interface
- Error handling

### Phase 3: Advanced Features
- Paste expiration implementation
- Syntax highlighting
- Password protection (optional)
- Rate limiting

### Phase 4: Refinement
- Performance optimization
- Enhanced UI
- Analytics
- Documentation

## Advanced Features (Future)

- **Custom URLs**: Allow users to choose custom paste IDs
- **Paste Encryption**: Client-side encryption for sensitive content
- **Diff View**: Compare multiple pastes
- **API Tokens**: Programmatic access to the pastebin service
- **Themes**: Light/dark mode for the UI