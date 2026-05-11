/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL: string;
  // Supabase project URL (public, baked into the build)
  readonly PUBLIC_SUPABASE_URL?: string;
  // Publishable key (sb_publishable_..., safe to ship to clients)
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Augment React DOM type declarations for full backward compatibility
declare module 'react-dom/client' {
  // Ensure all methods from react-dom are available through react-dom/client
  export * from 'react-dom';
}