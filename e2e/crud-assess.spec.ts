import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Assessments CRUD: scores, behavior records, and the monthly remark.
 *
 * Records are created with today's date, and the page's Month filter is then
 * set to the current month — seed scores all live in May/June 2026, so the
 * filtered list contains exactly the rows these tests created.
 */

const monthLabel = () =>
  new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

test.describe('CRUD: assessments', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/assessments'); // defaults to the first seeded student
  });

  test('score: create, edit, delete', async ({ page }) => {
    const k = ui(page);

    await page.getByRole('button', { name: 'Add score' }).click();
    await k.dlg.locator('.m-dialog__body input[type="number"]').fill('8.5');
    await k.pickSel('Assessment type', 'Giữa kỳ');
    let post = k.posted('/assessments');
    await k.submit().click(); // "Save" — disabled until a score is typed
    await post;

    await k.on(page).pickSel('Month', monthLabel());
    const row = page.locator('.lrow', { hasText: 'Giữa kỳ' });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.mchip', { hasText: '8.5' })).toBeVisible();

    await row.getByRole('button', { name: 'Edit' }).click();
    await k.dlg.locator('.m-dialog__body input[type="number"]').fill('9');
    post = k.posted('/assessments');
    await k.submit().click();
    await post;
    await expect(row.locator('.mchip', { hasText: '9' })).toBeVisible();

    // Score deletes confirm with a generic "Delete? / Confirm" dialog.
    await row.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/assessments');
    await k.dlgOf('Delete').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(row).toHaveCount(0);
  });

  test('behavior record: create, delete', async ({ page }) => {
    const k = ui(page);
    await page.getByRole('tab', { name: 'Attitude & behavior' }).click();

    // Defaults (type "Late", today's date) are a valid record as-is.
    await page.getByRole('button', { name: 'Log behavior' }).click();
    await k.textIn('Notes').fill('E2E behavior note');
    let post = k.posted('/assessments');
    await k.submit().click();
    await post;

    await k.on(page).pickSel('Month', monthLabel());
    const row = page.locator('.lrow', { hasText: 'E2E behavior note' });
    await expect(row).toBeVisible();

    // Edit: flip the type from the default "Late" to "Praise".
    await row.getByRole('button', { name: 'Edit' }).click();
    await k.pickSel('Type', 'Praise');
    post = k.posted('/assessments');
    await k.submit().click();
    await post;
    await expect(row.getByText('Praise')).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/assessments');
    await k.dlgOf('Delete').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(row).toHaveCount(0);
  });

  test('monthly remark: rate all criteria, save report, delete', async ({ page }) => {
    const k = ui(page);
    await page.getByRole('tab', { name: 'Monthly report' }).click();
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Monthly remark' }),
    });

    // "Save report" stays disabled until every active criterion has a rating —
    // the seed migration ships four criteria.
    await expect(card.getByRole('button', { name: '4', exact: true })).toHaveCount(4);
    for (const star of await card.getByRole('button', { name: '4', exact: true }).all()) {
      await star.click();
    }
    await card.locator('textarea.mochi-input').fill('E2E monthly comment');
    let post = k.posted('/assessments');
    await card.getByRole('button', { name: 'Save report' }).click();
    await post;
    await expect(card.locator('a', { hasText: 'Print report' })).toBeVisible();

    // Second save is an update (upsert on student+month): tweak the comment.
    await card.locator('textarea.mochi-input').fill('E2E monthly comment v2');
    post = k.posted('/assessments');
    await card.getByRole('button', { name: 'Save report' }).click();
    await post;
    await expect(card.locator('textarea.mochi-input')).toHaveValue('E2E monthly comment v2');

    await card.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/assessments');
    await k.dlgOf('Delete').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(card.locator('a', { hasText: 'Print report' })).toHaveCount(0);
  });

  /**
   * The garden block on the monthly report. Read-only — it has no write path of its own — so
   * what is worth pinning down is that it fetches the pair actually on screen and refetches when
   * either half of that pair changes. Both are the kind of thing a stale-key bug breaks silently.
   */
  test('garden progress: loads for the shown student and month, and refetches on change', async ({
    page,
  }) => {
    const k = ui(page);
    /** Resolves on the GET for one student's month summary. */
    const monthLoad = (studentId?: string) =>
      page.waitForResponse((r) => {
        const u = new URL(r.url());
        return (
          r.request().method() === 'GET' &&
          u.pathname.startsWith('/api/garden/month/') &&
          (!studentId || u.pathname.endsWith(`/${studentId}`)) &&
          r.ok()
        );
      });

    const thisMonth = new Date().toISOString().slice(0, 7);

    // The screen opens on the first seeded student, so the first fetch must be Leo's.
    let load = monthLoad('s1');
    await page.getByRole('tab', { name: 'Monthly report' }).click();
    // The month it asked for is the one the report is showing — the current month by default,
    // since the Month filter starts cleared.
    expect(new URL((await load).url()).searchParams.get('month')).toBe(thisMonth);

    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Vocabulary garden' }),
    });
    await expect(card).toBeVisible();
    // Six tiles, and every one carries a number rather than the em-dash placeholder that shows
    // while the fetch is still in flight.
    const tiles = card.locator('.statcard__num');
    await expect(tiles).toHaveCount(6);
    for (const n of await tiles.allTextContents()) expect(n).toMatch(/^\d+$/);

    // A different student is a different summary: switching to Mia refetches under her id.
    load = monthLoad('s2');
    await k.on(page).pickSel('Student', 'Mia Chen');
    expect(new URL((await load).url()).searchParams.get('month')).toBe(thisMonth);
    await expect(tiles).toHaveCount(6);

    // So is a different month. Seed scores live in May/June 2026, so that month is in the picker.
    load = monthLoad('s2');
    await k.on(page).pickSel('Month', 'June 2026');
    expect(new URL((await load).url()).searchParams.get('month')).toBe('2026-06');
    await expect(tiles).toHaveCount(6);
  });
});
