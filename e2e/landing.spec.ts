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
    await expect(h1).toContainText('cuốn lịch');
    await page.locator('.landing-lang-btn').click();
    await expect(h1).toContainText('playful calendar');
  });

  test('the facts band renders four verifiable-fact cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.landing-facts .landing-fact')).toHaveCount(4);
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

test.describe('marketing pages', () => {
  const pages = [
    { path: '/features', h1: /Mochi/ },
    { path: '/pricing', h1: /Bảng giá|Pricing/ },
    { path: '/about', h1: /Về Mochi|About/ },
    { path: '/guides', h1: /Hướng dẫn|guides/i },
  ];
  for (const p of pages) {
    test(`${p.path} renders inside the landing shell`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.locator('.landing-page-head h1')).toContainText(p.h1);
      await expect(page.locator('.landing-header')).toBeVisible();
      await expect(page.locator('.landing-footer')).toBeVisible();
    });
  }

  test('desktop nav navigates to pricing', async ({ page }) => {
    await page.goto('/');
    await page.locator('.landing-nav__links a[href="/pricing"]').click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator('.landing-price-figure')).toBeVisible();
  });

  test('mobile burger menu opens and navigates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator('.landing-burger').click();
    await page.locator('.landing-mobile-menu a[href="/features"]').click();
    await expect(page).toHaveURL(/\/features$/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('pricing shows the signup CTA', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('.landing-price-card a[href*="/signup"]')).toBeVisible();
  });

  test('pricing shows the FAQ', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('.landing-faq .landing-faq__row')).toHaveCount(3);
  });

  test('about shows the values cards', async ({ page }) => {
    await page.goto('/about');
    await expect(page.locator('.landing-values .landing-value')).toHaveCount(3);
  });
});
