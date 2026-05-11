/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Augment React DOM type declarations for full backward compatibility
declare module 'react-dom/client' {
  // Ensure all methods from react-dom are available through react-dom/client
  export * from 'react-dom';
}