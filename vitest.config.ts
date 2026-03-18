import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/tests/**/*.test.ts', 'astro/src/lib/**/*.test.ts'],
		exclude: ['e2e/**', 'astro/src/components/**'],
	},
});
