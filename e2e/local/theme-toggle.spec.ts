import { test, expect } from '@playwright/test';

test.describe('Theme toggle (local)', () => {
	test('cycling theme flips the dark class on <html>', async ({ page }) => {
		// Seed localStorage BEFORE navigation so the hydrated component picks it up.
		await page.addInitScript(() => localStorage.setItem('theme', 'light'));
		await page.goto('/');

		// Wait for ThemeToggle to hydrate — aria-label reflects the active mode.
		const toggle = page.locator('button[aria-label^="Theme:"]').first();
		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-label', /Theme:\s*Light/);
		await expect(page.locator('html')).toHaveClass(/(^|\s)light(\s|$)/);

		// Click once: cycle to dark.
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-label', /Theme:\s*Dark/);
		await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
	});
});
