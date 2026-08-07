import { test, expect, type Page } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent } from './crud-helpers';

/**
 * The sidebar's collapsible sections (src/lib/sidebar-nav.tsx).
 *
 * Read-only as far as the database goes, but it signs in with the seeded test
 * accounts, so it lives behind the same crudGuard as the CRUD specs. The 1400px
 * default viewport keeps us out of the ≤720px icon rail, where collapse is
 * deliberately ignored.
 */

const SECTIONS = ['Overview', 'Teaching', 'Grading', 'Learning', 'Admin'];

const header = (page: Page, name: string) => page.locator('.sb__section').filter({ hasText: name });
/** The row container the header's aria-controls points at. */
const group = (page: Page, id: string) => page.locator(`#sb-group-${id}`);
const storedCollapsed = (page: Page) =>
  page.evaluate(() => localStorage.getItem('mochi_sb_collapsed_v1'));

test.describe('sidebar: collapsible sections', () => {
  crudGuard();

  test('collapse, roll up badges, auto-expand on navigation, persist', async ({ page }) => {
    await signInStaff(page);

    // All five sections, expanded on first load (nothing stored yet).
    for (const name of SECTIONS) {
      await expect(header(page, name)).toHaveAttribute('aria-expanded', 'true');
    }

    // The Tests row's badge, if the seed has anything awaiting grading.
    const testsRow = page.locator('.sb__item[href="/tests"]');
    await expect(testsRow).toBeVisible();
    const badge = testsRow.locator('.count');
    const gradingCount = (await badge.count()) > 0 ? (await badge.innerText()).trim() : null;

    // --- collapse hides the rows but keeps them mounted (the icon rail needs them)
    await header(page, 'Grading').click();
    await expect(header(page, 'Grading')).toHaveAttribute('aria-expanded', 'false');
    await expect(group(page, 'grading')).toBeHidden();
    await expect(testsRow).toBeHidden();
    await expect(testsRow).toHaveCount(1);
    // Other sections are unaffected.
    await expect(group(page, 'teaching')).toBeVisible();
    expect(await storedCollapsed(page)).toBe('["grading"]');

    // --- the hidden rows' badge counts roll up onto the header
    if (gradingCount) {
      await expect(header(page, 'Grading').locator('.count')).toHaveText(gradingCount);
    }

    // --- navigating into a collapsed section force-expands it
    await page.goto('/tests');
    await expect(header(page, 'Grading')).toHaveAttribute('aria-expanded', 'true');
    await expect(testsRow).toBeVisible();
    await expect(header(page, 'Grading').locator('.count')).toHaveCount(0);
    // The auto-expand is written back, so storage matches the screen.
    expect(await storedCollapsed(page)).toBe('[]');

    // --- collapse survives a reload; the landing section stays open
    await header(page, 'Teaching').click();
    await expect(group(page, 'teaching')).toBeHidden();
    await page.reload();
    // Applied by a post-mount localStorage read, so poll rather than assert once.
    await expect(header(page, 'Teaching')).toHaveAttribute('aria-expanded', 'false');
    await expect(header(page, 'Grading')).toHaveAttribute('aria-expanded', 'true');
    expect(await storedCollapsed(page)).toBe('["teaching"]');

    // --- a stored collapse never hides the page the user landed on
    await page.goto('/people'); // a Teaching row
    await expect(header(page, 'Teaching')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.sb__item[href="/people"]')).toBeVisible();
    expect(await storedCollapsed(page)).toBe('[]');
  });

  test('students see only their own section', async ({ page }) => {
    await signInStudent(page);
    await expect(header(page, 'Learning')).toBeVisible();
    for (const name of ['Overview', 'Teaching', 'Grading', 'Admin']) {
      await expect(header(page, name)).toHaveCount(0);
    }
    // Still collapsible for them.
    await header(page, 'Learning').click();
    await expect(group(page, 'learning')).toBeHidden();
  });
});
