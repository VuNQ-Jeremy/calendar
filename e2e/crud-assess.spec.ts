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
    /**
     * Resolves on the GET for one student's month summary.
     *
     * `/garden-month`, not `/api/garden/month/:id` — /api/* is bearer-only and 401s a browser.
     * Single-fetch appends `.data` to the path a `useFetcher().load` asks for. The `r.ok()` here
     * is the whole point of the assertion: the first version of this card pointed at /api/* and
     * every call came back 401, which the card's degrade-to-null branch hid completely.
     */
    const monthLoad = (studentId?: string) =>
      page.waitForResponse((r) => {
        const u = new URL(r.url());
        return (
          r.request().method() === 'GET' &&
          u.pathname.startsWith('/garden-month') &&
          (!studentId || u.searchParams.get('student') === studentId) &&
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

  test('report roster: coverage counter, status badges, row click switches student', async ({
    page,
  }) => {
    const k = ui(page);
    await page.getByRole('tab', { name: 'Monthly report' }).click();

    const roster = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Students', exact: true }),
    });
    await expect(roster).toBeVisible();
    // Coverage header always reads n/m — n depends on rows other tests may have left behind.
    await expect(roster.getByText(/\d+\/\d+ reports written/)).toBeVisible();
    // Four seeded students, one row each (default class filter is "All classes").
    await expect(roster.locator('.assess-report__roster-row')).toHaveCount(4);

    // Clicking a roster row drives the same state as the Student dropdown: the remark form
    // re-keys to the clicked student, so its print link now carries her id.
    await roster.locator('.assess-report__roster-row', { hasText: 'Mia Chen' }).click();
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Monthly remark' }),
    });

    // Writing a report flips the badge to Written and bumps the counter by one.
    const before = await roster.getByText(/\d+\/\d+ reports written/).textContent();
    const beforeN = Number(before!.match(/(\d+)\//)![1]);
    for (const star of await card.getByRole('button', { name: '5', exact: true }).all()) {
      await star.click();
    }
    let post = k.posted('/assessments');
    await card.getByRole('button', { name: 'Save report' }).click();
    await post;
    await expect(card.locator('a', { hasText: 'Print report' })).toHaveAttribute(
      'href',
      /\/s2\/report$/,
    );
    const miaRow = roster.locator('.assess-report__roster-row', { hasText: 'Mia Chen' });
    await expect(miaRow.getByText('Written')).toBeVisible();
    // Zalo is disabled in the test env, so a Sent badge can never appear here.
    await expect(miaRow.getByText('Sent')).toHaveCount(0);
    await expect(roster.getByText(`${beforeN + 1}/`)).toBeVisible();

    // Clean up the row this test created.
    post = k.posted('/assessments');
    await card.getByRole('button', { name: 'Delete' }).click();
    await k.dlgOf('Delete').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(miaRow.getByText('Written')).toHaveCount(0);
  });

  test('report slip: prints real attendance and per-class scores for a seeded month', async ({
    page,
  }) => {
    // June 2026 is the seeded month: attendance rows exist only for 2026-06-22 (s1 present in
    // Biology 9A), and s1 has June scores in c1 and c3. Navigate the document route directly.
    await page.goto('/assessments/2026-06/s1/report');
    await expect(page.getByRole('heading', { name: 'MONTHLY STUDENT REPORT' })).toBeVisible();

    // Attendance section: the real roll, per class.
    await expect(page.getByText('Attendance', { exact: true })).toBeVisible();
    await expect(page.locator('.rslip__table', { hasText: 'Biology 9A' }).first()).toBeVisible();

    // Per-class scores: Biology 9A (7.5, 8.5 -> 8) and World Lit (8) both print.
    await expect(page.getByText('Scores by class')).toBeVisible();
    await expect(page.getByText('World Lit')).toBeVisible();

    // No vocab assignments are seeded for June, so the homework section stays off the slip.
    await expect(page.getByText('Vocabulary homework')).toHaveCount(0);
  });
});
