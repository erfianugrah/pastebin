import { test, expect } from '@playwright/test';

test.describe('Header brand mark (local)', () => {
	test('logo svg + wordmark render on home', async ({ page }) => {
		await page.goto('/');

		const brand = page.locator('header a[href="/"]').first();
		await expect(brand).toBeVisible();
		await expect(brand).toContainText('Pasteriser');

		const logo = brand.locator('img[src="/favicon.svg"]');
		await expect(logo).toBeVisible();
		await expect(logo).toHaveAttribute('aria-hidden', 'true');
	});

	test('header is sticky', async ({ page }) => {
		await page.goto('/');
		const header = page.locator('header').first();
		await expect(header).toBeVisible();
		await expect(header).toHaveClass(/sticky/);
	});
});
