# Pastebin Features Documentation

This document describes the features implemented in the Pastebin application, along with usage examples and configuration options.

## Core Features

### Basic Paste Functionality

#### Creating Pastes

Users can create pastes with the following options:

- **Content**: The main text/code content (required)
- **Title**: Optional title for the paste
- **Language**: Programming language for syntax highlighting
- **Expiration**: How long until the paste expires
- **Visibility**: Public or private

Example:

```json
{
  "content": "console.log('Hello, World!');",
  "title": "JavaScript Example",
  "language": "javascript",
  "expiration": 86400,
  "visibility": "public"
}
```

#### Viewing Pastes

Pastes can be viewed in three ways:

1. **Web UI**: User-friendly interface with syntax highlighting
2. **API**: JSON response with paste metadata and content
3. **Raw**: Plain text content only

#### Syntax Highlighting

The application supports syntax highlighting for many languages, including:

- JavaScript/TypeScript
- Python
- HTML/CSS
- Java
- C/C++/C#
- Ruby
- Go
- Rust
- PHP
- SQL
- YAML/JSON
- Markdown
- and many more...

The highlighting is performed using highlight.js in the UI.

#### Expiration Policies

Pastes can be configured to expire after:

- 1 hour (3600 seconds)
- 1 day (86400 seconds) - Default
- 1 week (604800 seconds)
- 30 days (2592000 seconds)
- 1 year (31536000 seconds)

Expired pastes are automatically deleted when accessed.

### Security and Privacy Features

#### Password Protection

Pastes can be protected with a password to restrict access:

```json
{
  "content": "Sensitive information here",
  "password": "secret123"
}
```

When accessing a password-protected paste:
- The user will be prompted for the password
- The content is only revealed after correct password entry
- Passwords are hashed using SHA-256 via WebCrypto API

#### Burn After Reading

Pastes can be configured to self-destruct after being viewed:

```json
{
  "content": "This message will self-destruct",
  "burnAfterReading": true
}
```

When a burn-after-reading paste is viewed:
1. The content is displayed to the viewer
2. A warning banner indicates this is a one-time view
3. The paste is immediately deleted from storage
4. Subsequent attempts to access the paste return 404

#### Private Visibility

Pastes can be marked as private:

```json
{
  "content": "Private content",
  "visibility": "private"
}
```

Private pastes:
- Don't appear in listings of recent pastes
- Are only accessible via direct URL

### User Experience Features

#### Raw View

Every paste has a raw view option that:
- Displays only the content without UI elements
- Uses appropriate content-type headers
- Makes it easy to copy or embed the content

Access via: `/pastes/raw/{pasteId}`

#### Copy to Clipboard

The UI includes a copy-to-clipboard button that:
- Copies the entire paste content
- Provides visual feedback when copied
- Works across modern browsers

#### Line Numbers

Code pastes are displayed with line numbers for:
- Easier reference in discussions
- Better readability of structured content
- Consistent formatting

## Infrastructure Features

### Caching

The application implements a strategic caching system:

- **Paste Views**: Cached for 1 hour
- **Static Assets**: Cached for 1 day with stale-while-revalidate for 1 week
- **API Responses**: Cache headers set based on content type

Caching is implemented via standard HTTP headers:
- `Cache-Control`
- `Vary`
- `Expires`

### Logging

The application uses a comprehensive logging system:

- **Structured Logging**: JSON-formatted logs via Pino
- **Log Levels**: trace, debug, info, warn, error, fatal
- **Contextual Information**: Request IDs, paste IDs, client info
- **Storage**: Critical logs stored in KV for later retrieval
- **Query API**: Endpoint for retrieving and filtering logs

### Error Handling

The application implements a standardized error handling approach:

- **Centralized Handling**: Via the `AppError` class
- **Error Categories**: Validation, not found, rate limit, etc.
- **Consistent Responses**: Standard error format
- **Logging**: All errors are logged with context
- **Client Feedback**: Clear error messages for users

### Rate Limiting

To protect the service from abuse, rate limiting is implemented:

- **General Rate Limit**: 60 requests per minute
- **Paste Creation Limit**: 10 pastes per minute
- **Headers**: Standard `Retry-After` header
- **Response**: Clear explanation of limit and retry time

### Analytics

The application tracks usage metrics:

- **Paste Creation**: Count, language, visibility
- **Paste Views**: Count, referring sources
- **API Usage**: Endpoint popularity, error rates
- **Storage**: Anonymous data stored in KV
- **Privacy**: No personally identifiable information

## Feature Configuration

Many features can be configured via the `ConfigurationService`:

```typescript
const config = {
  application: {
    name: 'pastebin',
    version: '1.0.0',
    baseUrl: 'https://paste.example.com',
  },
  storage: {
    namespace: 'PASTES',
    expirationStrategy: 'hybrid',
  },
  security: {
    rateLimit: {
      enabled: true,
      requestsPerMinute: 60,
    },
    allowedOrigins: ['*'],
  },
  paste: {
    maxSize: 1024 * 1024, // 1MB
    defaultExpiration: 86400, // 1 day
    allowedLanguages: undefined, // All languages allowed
    maxRecentLimit: 100,
  },
  logging: {
    level: 'info',
    pretty: false,
  },
};
```

## Roadmap and Future Features

Planned features for future development:

### User Accounts
- Authentication and authorization
- User profiles
- Personal paste collections

### Advanced UI
- Dark mode support
- Additional themes
- Mobile app version

### Enhanced Sharing
- Direct social media sharing
- Embedding options
- QR code generation

### Collaboration
- Collaborative editing
- Comments and discussions
- Version history

### Admin Dashboard
- Usage statistics
- Content moderation
- User management