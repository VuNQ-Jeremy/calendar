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

  test('collapse, roll up badges, auto-expand on navigation, reset per load', async ({ page }) => {
    await signInStaff(page);

    // Sections default to collapsed, so the sidebar opens as five headings —
    // except Overview, which owns the /dashboard the sign-in lands on.
    for (const name of SECTIONS) {
      await expect(header(page, name)).toBeVisible();
      await expect(header(page, name)).toHaveAttribute(
        'aria-expanded',
        name === 'Overview' ? 'true' : 'false',
      );
    }
    // Each heading carries its own icon.
    for (const name of SECTIONS) {
      await expect(header(page, name).locator('.sb__section-icon')).toHaveCount(1);
    }

    // --- a collapsed section hides its rows but keeps them mounted (the icon
    // rail needs them)
    const testsRow = page.locator('.sb__item[href="/tests"]');
    await expect(testsRow).toHaveCount(1);
    await expect(testsRow).toBeHidden();
    await expect(group(page, 'grading')).toBeHidden();

    // --- the hidden rows' badge counts roll up onto the header
    const rollup = header(page, 'Grading').locator('.count');
    const gradingCount = (await rollup.count()) > 0 ? (await rollup.innerText()).trim() : null;

    // --- expanding reveals the rows and moves the badge back onto its own row
    await header(page, 'Grading').click();
    await expect(header(page, 'Grading')).toHaveAttribute('aria-expanded', 'true');
    await expect(testsRow).toBeVisible();
    await expect(rollup).toHaveCount(0);
    if (gradingCount) {
      await expect(testsRow.locator('.count')).toHaveText(gradingCount);
    }
    // Collapsed ids are what gets stored, so an expanded grading drops out.
    const afterExpand = JSON.parse((await storedCollapsed(page))!);
    expect(afterExpand).not.toContain('grading');
    expect(afterExpand).toContain('admin');

    // --- a reload resets to exactly one expanded section: the active one.
    // Grading was expanded by hand above, but /dashboard is an Overview page,
    // so the fresh load drops Grading and opens Overview instead.
    await page.reload();
    await expect(header(page, 'Overview')).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Teaching', 'Grading', 'Learning', 'Admin']) {
      await expect(header(page, name)).toHaveAttribute('aria-expanded', 'false');
    }
    // Storage was rewritten to match, rather than left holding the stale set.
    expect(JSON.parse((await storedCollapsed(page))!).sort()).toEqual([
      'admin',
      'grading',
      'learning',
      'teaching',
    ]);

    // --- navigating into a collapsed section force-expands it, and the
    // auto-expand is written back so storage matches the screen
    await page.goto('/tests');
    await expect(header(page, 'Grading')).toHaveAttribute('aria-expanded', 'true');
    await expect(testsRow).toBeVisible();
    expect(JSON.parse((await storedCollapsed(page))!)).not.toContain('grading');

    // --- a stored collapse never hides the page the user landed on, and the
    // section the previous load opened does not carry over: each load expands
    // exactly one section, so the rail never accumulates open sections.
    await page.goto('/people'); // a Teaching row
    await expect(header(page, 'Teaching')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.sb__item[href="/people"]')).toBeVisible();
    expect(JSON.parse((await storedCollapsed(page))!)).not.toContain('teaching');
    await expect(header(page, 'Grading')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.sb__section[aria-expanded="true"]')).toHaveCount(1);
  });

  test('the sidebar keeps a hairline scrollbar whatever the preset', async ({ page }) => {
    await signInStaff(page);
    // Force the rail to overflow so a gutter actually exists to measure.
    await page.setViewportSize({ width: 1400, height: 300 });
    const gutter = async () =>
      page.evaluate(() => {
        const sb = document.querySelector('.sb') as HTMLElement;
        // offsetWidth includes the scrollbar gutter, clientWidth does not.
        return {
          gutter: sb.offsetWidth - sb.clientWidth,
          overflowing: sb.scrollHeight > sb.clientHeight,
        };
      });
    expect((await gutter()).overflowing, 'the rail must overflow for this to mean anything').toBe(
      true,
    );

    // The .sb rule must outweigh every html[data-scrollbar='…'] preset — 'inset'
    // is the one that would otherwise render a 12px bar.
    for (const preset of ['slim', 'inset', 'brand', 'ghost']) {
      await page.evaluate(
        (p) => document.documentElement.setAttribute('data-scrollbar', p),
        preset,
      );
      const { gutter: w } = await gutter();
      expect(w, `preset ${preset}`).toBeLessThanOrEqual(2);
    }
  });

  test('students see only their own section', async ({ page }) => {
    await signInStudent(page);
    await expect(header(page, 'Learning')).toBeVisible();
    for (const name of ['Overview', 'Teaching', 'Grading', 'Admin']) {
      await expect(header(page, name)).toHaveCount(0);
    }
    // Students land on /vocabulary, which Learning owns, so it starts expanded
    // and stays collapsible.
    await expect(header(page, 'Learning')).toHaveAttribute('aria-expanded', 'true');
    await header(page, 'Learning').click();
    await expect(group(page, 'learning')).toBeHidden();
  });
});
