# Pasteriser Documentation

Welcome to the Pasteriser documentation. This directory contains comprehensive documentation for our modern, secure code sharing platform built with Cloudflare Workers and Astro.

## Core Documentation

| Document | Description |
|----------|-------------|
| [**Architecture**](ARCHITECTURE.md) | Complete system architecture and design principles |
| [**Frontend**](FRONTEND.md) | Frontend architecture, browser integration, and performance optimization |
| [**Encryption**](ENCRYPTION.md) | End-to-end encryption implementation details |
| [**API Reference**](API.md) | API endpoints and integration details |
| [**Setup Guide**](SETUP.md) | Initial setup and configuration instructions |
| [**Development Guide**](DEVELOPMENT.md) | Development workflow and processes |

## Technical Guides

| Document | Description |
|----------|-------------|
| [**E2EE Testing**](E2EE_TESTING.md) | Testing procedures for encryption features |
| [**PWA Setup**](PWA_SETUP.md) | Progressive Web App configuration details |

## Internal Documentation

| Document | Description |
|----------|-------------|
| [**Next Steps**](NEXT_STEPS.md) | Upcoming task prioritization and future plans |
| [**Progress**](PROGRESS.md) | Current project status and completed milestones |
| [**Enhancement Plan 2025**](ENHANCEMENT_PLAN_2025.md) | Planned improvements for 2025 |

## Consolidated Documentation

The following documents have been consolidated for better organization:
- BROWSER_INTEGRATION.md → [FRONTEND.md](FRONTEND.md)
- FRONTEND_ARCHITECTURE.md → [FRONTEND.md](FRONTEND.md)
- UI-APPROACH.md → [FRONTEND.md](FRONTEND.md)

## Directory Structure

```
pastebin/
├── astro/                  # Astro UI project
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── layouts/        # Page layouts
│   │   ├── lib/            # Utilities and libraries
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

- **Secure Sharing**: End-to-end encryption for sensitive content
- **Syntax Highlighting**: Support for 40+ programming languages
- **Expiration Policies**: Auto-expiring pastes with configurable TTL
- **Performance Optimized**: Web Workers for crypto operations
- **Responsive UI**: Works on mobile and desktop devices
- **Progressive Web App**: Offline support and installable experience
- **Accessibility**: ARIA compliant with keyboard navigation

## Development Workflow

1. Run local development server: `npm run dev:all`
2. Build for production: `npm run build`
3. Deploy to Cloudflare: `npm run deploy`

## Testing

Run tests with: `npm test`