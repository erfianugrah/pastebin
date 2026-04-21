import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://paste.erfi.dev',
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
});