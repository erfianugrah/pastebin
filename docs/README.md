# Pastebin Project Documentation

This directory contains comprehensive documentation for the Pastebin application built with Cloudflare Workers and Astro.

## Core Documentation

- [**Project Architecture**](../pastebin-architecture.md) - Overall architecture and design principles
- [**API Documentation**](API.md) - API endpoints, requests, and responses
- [**Setup Guide**](SETUP.md) - How to set up and run the application
- [**Development Guide**](DEVELOPMENT.md) - Development workflow and guidelines

## Technical Documentation

- [**UI Approach**](UI-APPROACH.md) - Design and implementation of the Astro UI
- [**Integration Guide**](INTEGRATION.md) - How the UI and Worker are integrated
- [**Enhancement Plan**](ENHANCEMENT_PLAN.md) - Planned improvements and features

## Project Management

- [**Project Plan**](PROJECT_PLAN.md) - Overall project implementation plan
- [**Progress Report**](PROGRESS.md) - Current status and completed tasks
- [**Next Steps**](NEXT_STEPS.md) - Immediate next steps for the project

## Directory Structure

The Pastebin project follows a Domain-Driven Design architecture:

```
pastebin/
├── astro/                  # Astro UI project
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── layouts/        # Page layouts
│   │   ├── pages/          # Route pages
│   │   └── styles/         # Global styles
│   └── public/             # Static assets
├── src/                    # Worker code
│   ├── domain/             # Domain models and business logic
│   ├── application/        # Application services
│   ├── infrastructure/     # External infrastructure
│   └── interfaces/         # API and UI interfaces
└── docs/                   # Documentation
```

## Key Features

- **Create and View Pastes**: Share code or text snippets
- **Syntax Highlighting**: Support for multiple programming languages
- **Expiration Policies**: Pastes expire automatically after a set time
- **Responsive UI**: Works on desktop and mobile devices

## Deployment

The application is deployed to Cloudflare Workers and accessible at:

- Production: [paste.erfianugrah.com](https://paste.erfianugrah.com)
- Staging: [paste-staging.erfianugrah.com](https://paste-staging.erfianugrah.com)

## Development Workflow

1. Run local development server: `npm run dev:all`
2. Build for production: `npm run build`
3. Deploy to Cloudflare: `npm run deploy`
4. Deploy to production: `npm run deploy:prod`
5. Deploy to staging: `npm run deploy:staging`

## Testing

Run tests with: `npm test`

## Known Issues and Limitations

- Rate limiting not yet implemented
- No user authentication system
- Limited monitoring and analytics