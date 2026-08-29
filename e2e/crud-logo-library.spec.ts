import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent } from './crud-helpers';

/**
 * /logo-library — the mascot artwork catalogue.
 *
 * Read-only: the route has no action, so there is no create/edit/delete lifecycle to walk. What
 * is worth asserting is the gate (it is admin-only reference art) and that filtering happens in
 * the URL, because the loader reads the same params the UI writes -- if those two ever disagree,
 * the page silently shows the wrong slice.
 *
 * The row data comes from scripts/logo-library-seed.sql, which is NOT part of the test-env reset
 * (logo_library is global reference data, like the grade levels, so the reset sweep leaves it
 * alone). The catalogue assertions therefore run only when the library has actually been seeded
 * into calendar-test, and the page's own empty state is asserted when it has not.
 */

test.describe('CRUD: logo library', () => {
  crudGuard();

  test('is admin-only: a student never reaches the catalogue', async ({ page }) => {
    await signInStudent(page);
    await page.goto('/logo-library');
    // The guard is requireAdmin; a student is bounced rather than shown an empty grid.
    await expect(page.locator('.logo-grid')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Logos' })).toHaveCount(0);
  });

  test('renders the catalogue, and filters through the URL', async ({ page }) => {
    await signInStaff(page);
    await page.goto('/logo-library');
    await expect(page.getByRole('heading', { name: 'Logos' })).toBeVisible();

    const grid = page.locator('.logo-grid');
    if ((await grid.count()) === 0) {
      // Not seeded here: assert the page says so in the actionable way, then stop.
      await expect(page.getByText('The library table is empty.')).toBeVisible();
      test.skip(true, 'logo_library not seeded in this environment');
      return;
    }

    const allTiles = await page.locator('.logo-tile').count();
    expect(allTiles).toBeGreaterThan(0);

    // A category chip narrows the set and says so in the URL, so the view is linkable.
    await page.getByRole('button', { name: /^Mammals/ }).click();
    await expect(page).toHaveURL(/[?&]cat=mammal/);
    await expect(page.locator('.logo-tile').first()).toBeVisible();

    // Searching narrows further and clears any page offset, so we never land past the end.
    await page.getByLabel('Search subject or name').fill('cat');
    await expect(page).toHaveURL(/[?&]q=cat/);
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(page.locator('.logo-tile').first()).toBeVisible();

    // Every visible caption really is a match, not a stale render of the previous filter.
    const captions = await page.locator('.logo-tile figcaption').allInnerTexts();
    expect(captions.length).toBeGreaterThan(0);
    for (const caption of captions) expect(caption.toLowerCase()).toContain('cat');
  });

  test('a deep-linked filter loads already applied', async ({ page }) => {
    await signInStaff(page);
    await page.goto('/logo-library?cat=bird');
    await expect(page.getByRole('heading', { name: 'Logos' })).toBeVisible();

    if ((await page.locator('.logo-grid').count()) === 0) {
      test.skip(true, 'logo_library not seeded in this environment');
      return;
    }
    // The loader, not the client, applied this -- the first paint is already the filtered set.
    await expect(page.locator('.logo-tile').first()).toBeVisible();
  });
});
