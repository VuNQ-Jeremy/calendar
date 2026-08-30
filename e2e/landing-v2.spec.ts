import { test, expect } from '@playwright/test';

/**
 * The alternate ("v2", claymorphism) marketing site at `/v2` (routes/landing-v2.*.tsx).
 *
 * Read-only spec, same style as landing.spec.ts — it creates nothing, so it may run
 * against any deployment. /v2 has no signed-in redirect (unlike `/`), so there is no
 * equivalent to that landing.spec.ts test here.
 */

test.describe('landing v2 page', () => {
  test('a visit to /v2 renders without bouncing to /login', async ({ page }) => {
    await page.goto('/v2');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('.lv2-hero h1')).toBeVisible();
    await expect(page.locator('.lv2-hero__cta a[href="/signup"]')).toBeVisible();
    await expect(page.locator('.lv2-hero__cta a[href="/login"]')).toBeVisible();
  });

  test('the language toggle swaps the copy', async ({ page }) => {
    await page.goto('/v2');
    const h1 = page.locator('.lv2-hero h1');
    // First visit defaults to Vietnamese (a post-mount effect, so wait for it).
    await expect(h1).toContainText('cuốn lịch');
    await page.locator('.lv2-lang-btn').click();
    await expect(h1).toContainText('playful calendar');
  });

  test('no horizontal overflow at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/v2');
    await expect(page.locator('.lv2-hero h1')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('v1 stays untouched: / still renders the original landing, not v2', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.landing-hero h1')).toBeVisible();
    await expect(page.locator('.lv2-hero')).toHaveCount(0);
  });
});

test.describe('marketing pages v2', () => {
  const pages = [
    { path: '/v2/features', h1: /What Mochi actually does|Mochi làm được gì/ },
    { path: '/v2/pricing', h1: /Pricing|Bảng giá/ },
    { path: '/v2/about', h1: /About Mochi|Về Mochi/ },
    { path: '/v2/guides', h1: /User guides|Hướng dẫn/i },
  ];
  for (const p of pages) {
    test(`${p.path} renders inside the v2 shell`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.locator('.lv2-page-head h1')).toContainText(p.h1);
      await expect(page.locator('.lv2-header')).toBeVisible();
      await expect(page.locator('.lv2-footer')).toBeVisible();
    });
  }

  test('desktop nav stays inside /v2 and navigates to pricing', async ({ page }) => {
    await page.goto('/v2');
    await page.locator('.lv2-nav__links a[href="/v2/pricing"]').click();
    await expect(page).toHaveURL(/\/v2\/pricing$/);
    await expect(page.locator('.lv2-price-figure')).toBeVisible();
  });

  test('mobile burger menu opens and navigates within /v2', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/v2');
    await page.locator('.lv2-burger').click();
    await page.locator('.lv2-mobile-menu a[href="/v2/features"]').click();
    await expect(page).toHaveURL(/\/v2\/features$/);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('pricing shows the signup CTA', async ({ page }) => {
    await page.goto('/v2/pricing');
    await expect(page.locator('.lv2-price-card a[href*="/signup"]')).toBeVisible();
  });
});
