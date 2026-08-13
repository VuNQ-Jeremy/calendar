import { test, expect, type Page } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Question bank bulk operations and the wipe. The spec seeds its own three
 * essay questions, drives the selection bar (bulk-meta, bulk-tags,
 * bulk-delete), then wipes the remainder — leaving the bank empty, which is
 * the state every other spec expects.
 */

test.describe('CRUD: question bulk operations', () => {
  crudGuard();

  async function createEssay(page: Page, prompt: string) {
    const k = ui(page);
    await page.getByRole('button', { name: 'New question' }).click();
    await k.textIn('Question').fill(prompt);
    await k.pickSel('Type', 'Essay');
    const post = k.posted('/questions');
    await k.submit().click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: prompt })).toBeVisible();
  }

  test('select, bulk difficulty, bulk tag, bulk delete, wipe', async ({ page }) => {
    const k = ui(page);
    const stamp = Date.now();
    const prompts = [1, 2, 3].map((n) => `E2E bulk q${n} ${stamp}`);
    await signInStaff(page);
    await page.goto('/questions');
    for (const p of prompts) await createEssay(page, p);

    // Select the first two rows via their (label-wrapped, invisible) checkboxes.
    const tick = (p: string) =>
      page.locator('.mochi-card', { hasText: p }).locator('label.mochi-check');
    await tick(prompts[0]).click();
    await tick(prompts[1]).click();
    await expect(page.getByText('2 selected')).toBeVisible();

    // bulk-meta: set difficulty. The trigger always redisplays "—", so assert
    // on the row badges instead.
    let post = k.posted('/questions');
    await k.on(page).pickSel('Set difficulty', 'Hard');
    await post;
    await expect(
      page.locator('.mochi-card', { hasText: prompts[0] }).getByText('Hard'),
    ).toBeVisible();
    await expect(
      page.locator('.mochi-card', { hasText: prompts[1] }).getByText('Hard'),
    ).toBeVisible();

    // bulk-tags: one tag for both rows.
    await k.on(page).textIn('Add tag').fill('e2e-bulk');
    post = k.posted('/questions');
    await page.getByRole('button', { name: 'Add tag', exact: true }).click();
    await post;
    await expect(page.getByText('Updated 2 questions')).toBeVisible();

    // bulk-delete the two selected.
    await page.getByRole('button', { name: 'Delete selected' }).click();
    post = k.posted('/questions');
    await k.dlgOf('Delete 2 questions?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(page.getByText('Deleted 2 questions')).toBeVisible();
    await expect(page.locator('.mochi-card', { hasText: prompts[0] })).toHaveCount(0);

    // Wipe the remainder — count-agnostic, since a prior failed spec may have
    // leaked questions into the bank.
    await page.getByRole('button', { name: 'Wipe bank' }).click();
    post = k.posted('/questions');
    await page
      .locator('.m-dialog', { has: page.getByText(/^Delete all \d+ questions\?$/) })
      .locator('.mochi-btn.is-danger')
      .click();
    await post;
    await expect(
      page.getByText(/^The question bank is empty\. Deleted \d+ questions\.$/),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wipe bank' })).toHaveCount(0);
  });
});
