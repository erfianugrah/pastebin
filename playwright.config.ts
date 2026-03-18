import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 30000,
	retries: 1,
	use: {
		baseURL: 'https://paste.erfi.dev',
		headless: true,
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
	],
});
