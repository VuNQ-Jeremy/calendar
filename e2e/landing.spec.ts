import { test, expect } from '@playwright/test';

/**
 * The public landing page at `/` (routes/home.tsx).
 *
 * Read-only spec — it creates nothing, so unlike the crud-*.spec.ts files it
 * may run against any deployment. The signed-in test needs the usual
 * MOCHI_EMAIL / MOCHI_PASSWORD staff credentials and skips without them.
 */

const EMAIL = process.env.MOCHI_EMAIL;
const PASSWORD = process.env.MOCHI_PASSWORD;

test.describe('landing page', () => {
  test('a logged-out visit to / renders the landing instead of bouncing to /login', async ({
    page,
  }) => {
    await page.goto('/');
    // The old behaviour was a redirect chain / → /dashboard → /login.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('.landing-hero h1')).toBeVisible();
    // Both CTAs are present and point into the app.
    await expect(page.locator('.landing-hero__cta a[href="/signup"]')).toBeVisible();
    await expect(page.locator('.landing-hero__cta a[href="/login"]')).toBeVisible();
  });

  test('the language toggle swaps the copy', async ({ page }) => {
    await page.goto('/');
    const h1 = page.locator('.landing-hero h1');
    // First visit defaults to Vietnamese (a post-mount effect, so wait for it).
    await expect(h1).toContainText('ngôi trường');
    await page.locator('.landing-lang-btn').click();
    await expect(h1).toContainText('whole school');
  });

  test('no horizontal overflow at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.landing-hero h1')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('a signed-in visit to / still lands in the app', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'Set MOCHI_EMAIL and MOCHI_PASSWORD to run this');
    await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL!);
    await page.fill('input[name="password"]', PASSWORD!);
    await page.click('form[action="/login"] button[type="submit"]');
    await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });
    await page.goto('/');
    await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });
  });
});
