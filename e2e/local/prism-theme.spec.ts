import { test, expect } from '@playwright/test';

test.describe('Prism theme (local)', () => {
	test('only the token-driven theme file is requested', async ({ page }) => {
		const themeUrls = new Set<string>();
		page.on('request', (req) => {
			const url = req.url();
			if (url.includes('/prism-themes/')) themeUrls.add(url);
		});
		await page.goto('/');
		await page.waitForLoadState('networkidle');

		// One unique theme URL, and it's the token-driven one.
		expect(themeUrls.size).toBe(1);
		const [only] = Array.from(themeUrls);
		expect(only).toContain('/prism-themes/prism-pasteriser.css');
		// Old themes must not appear.
		expect(only).not.toContain('prism-one-light');
		expect(only).not.toContain('prism-okaidia');
	});

	test('prose.css is loaded', async ({ page }) => {
		const proseUrls = new Set<string>();
		page.on('request', (req) => {
			const url = req.url();
			if (url.endsWith('/styles/prose.css')) proseUrls.add(url);
		});
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		expect(proseUrls.size).toBe(1);
	});
});
