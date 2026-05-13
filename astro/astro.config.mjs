import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://paste.erfi.io',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    react(),
  ],
  build: {
    assets: 'assets',
  },
  // Allow client-side routing for dynamic routes
  trailingSlash: 'never',

  // ── CSP (Content-Security-Policy) ──────────────────────────────────
  // Astro v6 emits per-page `<meta http-equiv="content-security-policy">`
  // with SHA-256 hashes of every bundled / inline script and style it
  // produced. That replaces the `'unsafe-inline'` allowance previously
  // set by the Worker — modern browsers ignore `'unsafe-inline'` when
  // a hash is present in the same directive (CSP3).
  //
  // The Worker still sets header-only directives that meta cannot
  // express (frame-ancestors, etc.); see `src/interfaces/api/middleware.ts`.
  // Header + meta intersect, so the stricter meta CSP wins for HTML.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "connect-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "object-src 'none'",
        "media-src 'self'",
        "worker-src 'self' blob:",
        "child-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});