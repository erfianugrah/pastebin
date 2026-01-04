import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
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