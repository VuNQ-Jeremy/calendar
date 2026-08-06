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

    await card.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/assessments');
    await k.dlgOf('Delete').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(card.locator('a', { hasText: 'Print report' })).toHaveCount(0);
  });
});
