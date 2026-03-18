import { test, expect } from '@playwright/test';

test.describe('Paste Lifecycle', () => {
	test('create a paste, view it, then delete it', async ({ page, request }) => {
		// Use API to create — faster and more reliable than UI
		const res = await request.post('/pastes', {
			data: { content: 'Hello from Playwright test', title: 'E2E Test Paste', expiration: 3600 },
		});
		const { id, deleteToken } = await res.json();

		// View the paste
		await page.goto(`/pastes/${id}`);
		await expect(page.locator('text=E2E Test Paste')).toBeVisible({ timeout: 10000 });
		await expect(page.locator('text=Hello from Playwright test')).toBeVisible();

		// Verify action buttons (icons always visible, labels may be hidden on mobile)
		await expect(page.locator('button:has-text("Delete")')).toBeVisible();

		// Delete via API (UI delete requires token in localStorage which is complex in E2E)
		const delRes = await request.delete(`/pastes/${id}/delete`, {
			data: { token: deleteToken },
		});
		expect(delRes.ok()).toBeTruthy();

		// Verify it's gone
		await page.reload();
		await expect(page.locator('text=Paste Not Found')).toBeVisible({ timeout: 10000 });
	});

	test('home page loads and form is interactive', async ({ page }) => {
		await page.goto('/');

		// Check header
		await expect(page.locator('text=Pasteriser')).toBeVisible();

		// Check form elements
		await expect(page.locator('textarea[name="content"]')).toBeVisible({ timeout: 10000 });
		await expect(page.locator('input[name="title"]')).toBeVisible();
		await expect(page.locator('button[type="submit"]')).toBeVisible();

		// Check theme toggle works
		const themeButton = page.locator('button[title*="Theme"]');
		await expect(themeButton).toBeVisible();
		await themeButton.click();
		// Should cycle through themes without errors
		await expect(themeButton).toBeVisible();
	});

	test('Security & Privacy section toggles', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('textarea[name="content"]')).toBeVisible({ timeout: 10000 });

		// Click Security & Privacy toggle
		await page.click('text=Security & Privacy');

		// Should reveal visibility and encryption dropdowns
		await expect(page.locator('text=Visibility')).toBeVisible();
		await expect(page.locator('text=Encryption')).toBeVisible();
	});

	test('recent pastes page loads', async ({ page }) => {
		await page.goto('/recent');
		await expect(page.locator('text=Recent Public Pastes')).toBeVisible({ timeout: 10000 });
	});

	test('404 page for nonexistent paste', async ({ page }) => {
		await page.goto('/pastes/nonexistent-paste-id');
		await expect(page.locator('text=Paste Not Found')).toBeVisible({ timeout: 10000 });
	});

	test('home page form elements are present and interactive', async ({ page }) => {
		await page.goto('/');

		// Wait for React to hydrate
		const textarea = page.locator('textarea[name="content"]');
		await expect(textarea).toBeVisible({ timeout: 10000 });

		// Type content
		await textarea.fill('Test content');
		await expect(textarea).toHaveValue('Test content');

		// Title input works
		const title = page.locator('input[name="title"]');
		await title.fill('Test Title');
		await expect(title).toHaveValue('Test Title');

		// Submit button exists and is enabled
		const submit = page.locator('button[type="submit"]');
		await expect(submit).toBeVisible();
		await expect(submit).toBeEnabled();
	});
});

test.describe('Vanity URLs', () => {
	test('create and access a paste via vanity URL', async ({ page, request }) => {
		// Create via API with a unique slug
		const slug = `e2e-test-${Date.now()}`;
		const res = await request.post('/pastes', {
			data: { content: 'vanity test', expiration: 3600, slug },
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.url).toContain(`/p/${slug}`);

		// Access via vanity URL
		await page.goto(`/p/${slug}`);
		await expect(page.locator('text=vanity test')).toBeVisible({ timeout: 10000 });

		// Clean up: delete via API
		await request.delete(`/pastes/${body.id}/delete`, {
			data: { token: body.deleteToken },
		});
	});
});

test.describe('API Endpoints', () => {
	test('POST /pastes returns correct shape', async ({ request }) => {
		const res = await request.post('/pastes', {
			data: { content: 'api test', expiration: 3600 },
		});
		expect(res.status()).toBe(201);
		const body = await res.json();
		expect(body).toHaveProperty('id');
		expect(body).toHaveProperty('url');
		expect(body).toHaveProperty('deleteToken');
		expect(body).toHaveProperty('expiresAt');

		// Clean up
		await request.delete(`/pastes/${body.id}/delete`, {
			data: { token: body.deleteToken },
		});
	});

	test('PUT /pastes/:id requires token', async ({ request }) => {
		const create = await request.post('/pastes', {
			data: { content: 'original', expiration: 3600 },
		});
		const { id, deleteToken } = await create.json();

		// Without token -> 403
		const badRes = await request.put(`/pastes/${id}`, {
			data: { content: 'hacked' },
		});
		expect(badRes.status()).toBe(403);

		// With token -> 200
		const goodRes = await request.put(`/pastes/${id}`, {
			data: { token: deleteToken, content: 'updated' },
		});
		expect(goodRes.status()).toBe(200);

		// Verify update
		const read = await request.get(`/pastes/${id}`, {
			headers: { Accept: 'application/json' },
		});
		const body = await read.json();
		expect(body.content).toBe('updated');

		// Clean up
		await request.delete(`/pastes/${id}/delete`, {
			data: { token: deleteToken },
		});
	});

	test('security headers are present', async ({ request }) => {
		const res = await request.get('/');
		expect(res.headers()['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
		expect(res.headers()['x-content-type-options']).toBe('nosniff');
		expect(res.headers()['x-frame-options']).toBe('DENY');
		expect(res.headers()['strict-transport-security']).toContain('max-age=');
	});
});
