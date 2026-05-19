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
  // We deliberately do NOT use Astro v6's `security.csp` feature. The
  // sole CSP layer is the header set by the Worker in
  // `src/interfaces/api/middleware.ts`.
  //
  // Why we tried Astro's hash-based CSP and walked away:
  //
  //   1. Astro v6 auto-appends `script-src 'self' 'sha256-…'` and
  //      `style-src 'self' 'sha256-…'` to the meta. CSP3 says any
  //      directive carrying a hash auto-disables `'unsafe-inline'` in
  //      that directive — so we couldn't relax the meta even if we
  //      wanted to.
  //   2. The whitelist of additional directives accepted by
  //      `security.csp.directives` (`ALLOWED_DIRECTIVES` in
  //      astro/dist/core/csp/config.js) excludes `style-src-attr`,
  //      `script-src-attr`, `script-src-elem`, `style-src-elem`,
  //      `script-src`, and `style-src` — Astro reserves these for its
  //      own emission. We can't add `style-src-attr 'unsafe-inline'`
  //      to override style-src for inline attribute styles.
  //   3. Astro hashes inline `<style>` blocks but NOT inline
  //      `style="…"` attributes. Radix UI's Select primitive emits
  //      two of those in its accessibility shim
  //      (`<span style="pointer-events:none">` and the visually-hidden
  //      native `<select>`). React renders dynamic inline styles for
  //      progress bars (PasteForm, CodeViewer, password-strength),
  //      tooltip positioning (Tooltip), and stagger animation
  //      (RecentPastes). Every one of these violates a hash-based
  //      style-src.
  //   4. Multiple CSPs on one resource compose by intersection of
  //      allowances, so the header's `script-src 'self'` AND the
  //      meta's `script-src 'self' 'sha256-…'` together yield "no
  //      inline" because the header blocks it. The meta hashes never
  //      relax the header. This was the 3.8.0 regression.
  //   5. Cloudflare's "Bot Fight Mode" injects an inline JS Detection
  //      beacon at the edge with a per-request nonce in the script
  //      body. Astro's pre-computed hash cannot match it. The only
  //      cure is to disable Bot Fight Mode in Cloudflare Dashboard →
  //      Security → Bots; that's outside this config.
  //
  // The Worker header (see middleware.ts) is the sole CSP layer. It
  // uses `'unsafe-inline'` for script-src / style-src / style-src-attr;
  // XSS prevention in HTML is provided by React's escaping and
  // DOMPurify on the markdown render path. CSP is policy / defense-
  // in-depth, not the only defense.
  security: {
    csp: false,
  },
});