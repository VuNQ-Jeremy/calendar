import { test, expect } from '@playwright/test';

/**
 * Google sign-in is inactive until GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are configured — neither
 * is set in calendar-test (or in prod, until the user completes the Google Cloud console step).
 * Read-only, so unlike the crud-*.spec.ts files this runs against any environment.
 */

test.describe('Google sign-in (disabled state)', () => {
  test('the button is hidden on /login when no OAuth client is configured', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveCount(0);
  });

  test('/auth/google redirects rather than 500ing when disabled', async ({ page }) => {
    const res = await page.goto('/auth/google');
    // googleEnabled() is false, so the loader redirects to /login instead of starting a flow
    // that could never finish — never a server error.
    expect(res?.status()).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });
});
