import { defineConfig } from '@playwright/test';

// Two projects:
//   chromium-prod  — hits the live deployment at paste.erfi.io
//   chromium-local — hits a local astro dev server. Auto-spawned via webServer.
//
// Run a specific project:
//   npx playwright test --project=chromium-prod   (default suite that needs API)
//   npx playwright test --project=chromium-local  (UI-only specs in e2e/local/)

export default defineConfig({
	testDir: './e2e',
	timeout: 30000,
	retries: 1,
	use: { headless: true },
	webServer: {
		command: 'cd astro && npm run dev -- --port 4321 --host 127.0.0.1',
		url: 'http://127.0.0.1:4321',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
	projects: [
		{
			name: 'chromium-prod',
			testIgnore: ['**/local/**'],
			use: { browserName: 'chromium', baseURL: 'https://paste.erfi.io' },
		},
		{
			name: 'chromium-local',
			testMatch: ['**/local/**/*.spec.ts'],
			use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:4321' },
		},
	],
});
