# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Pastebin Project

### Build & Test Commands
- **Development**: `npm run dev` (backend), `npm run dev:ui` (frontend), `npm run dev:all` (both)
- **Build**: `npm run build:ui` (frontend), `npm run build` (all)
- **Deploy**: `npm run deploy`, `npm run deploy:prod`, `npm run deploy:staging`
- **Test**: `npm test` (all tests), `npm run test:watch` (watch mode)
- **Run single test**: `vitest -t "test name"` or `vitest path/to/test.test.ts`
- **Lint/Check**: `npm run check` (TypeScript), `npm run lint` (ESLint)
- **CF Types**: `npm run cf-typegen` (generate Cloudflare types)

### Code Style Guidelines
- **TypeScript**: Use strict mode, explicit typing, prefer `unknown` over `any`
- **Naming**: PascalCase for classes/interfaces, camelCase for functions/variables
- **Architecture**: Follow Domain-Driven Design with clean architecture principles
- **Imports**: Use ES modules (import/export syntax)
- **Formatting**: 2-space indentation
- **Error Handling**: Use `AppError` for domain errors, catch all in API handlers
- **Structure**: Respect layer separation (domain, application, infrastructure, interface)

### Project Components
- **Backend**: Cloudflare Workers, TypeScript, Zod validation
- **Frontend**: Astro, React components, Tailwind CSS, shadcn/ui
- **Features**: Syntax highlighting, password protection, expiration, burn-after-reading