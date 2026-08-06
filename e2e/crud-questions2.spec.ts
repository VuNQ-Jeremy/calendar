import { test, expect, type Page } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Question-type variants beyond the essay covered in crud-tests.spec.ts:
 * multiple choice (radio answer key), the True/False preset, multi-select
 * (checkbox answer key), and short answer (accepted-answer chips).
 */

test.describe('CRUD: question type variants', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/questions');
  });

  const row = (page: Page, p: string) => page.locator('.mochi-card', { hasText: p });

  async function deleteQuestion(page: Page, prompt: string) {
    const k = ui(page);
    await row(page, prompt).getByRole('button', { name: 'Delete' }).click();
    const post = k.posted('/questions');
    await k.dlgOf('Delete this question?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(row(page, prompt)).toHaveCount(0);
  }

  test('multiple choice: two options, one marked correct', async ({ page }) => {
    const k = ui(page);
    const prompt = `E2E mcq ${Date.now()}`;

    await page.getByRole('button', { name: 'New question' }).click();
    await k.textIn('Question').fill(prompt);
    // Type defaults to Multiple choice; build the options by hand.
    await k.dlg.getByRole('button', { name: 'Add option' }).click();
    await k.dlg.getByRole('button', { name: 'Add option' }).click();
    await k.dlg.locator('input[placeholder="Option 1"]').fill('Right answer');
    await k.dlg.locator('input[placeholder="Option 2"]').fill('Wrong answer');
    // The correct-answer radios are the app's only name= attribute.
    await k.dlg.locator('input[name="qb-correct"]').first().check();
    const post = k.posted('/questions');
    await k.submit().click();
    await post;
    await expect(row(page, prompt)).toBeVisible();
    await expect(row(page, prompt).getByText('Multiple choice')).toBeVisible();

    await deleteQuestion(page, prompt);
  });

  test('true/false preset fills the options', async ({ page }) => {
    const k = ui(page);
    const prompt = `E2E true-false ${Date.now()}`;

    await page.getByRole('button', { name: 'New question' }).click();
    await k.textIn('Question').fill(prompt);
    await k.dlg.getByRole('button', { name: 'True / False' }).click();
    await expect(k.dlg.locator('input.mochi-input[value="True"]')).toBeVisible();
    await k.dlg.locator('input[name="qb-correct"]').first().check(); // True is correct
    const post = k.posted('/questions');
    await k.submit().click();
    await post;
    await expect(row(page, prompt)).toBeVisible();

    await deleteQuestion(page, prompt);
  });

  test('multi-select: three options, two correct', async ({ page }) => {
    const k = ui(page);
    const prompt = `E2E multi ${Date.now()}`;

    await page.getByRole('button', { name: 'New question' }).click();
    await k.textIn('Question').fill(prompt);
    await k.pickSel('Type', 'Multi-select');
    for (let i = 1; i <= 3; i++) {
      await k.dlg.getByRole('button', { name: 'Add option' }).click();
      await k.dlg.locator(`input[placeholder="Option ${i}"]`).fill(`Choice ${i}`);
    }
    // Multi-select marks correct answers with checkboxes on each option row.
    // The real input is opacity:0/width:0 — click the label wrapper instead.
    await k.dlg.locator('label.mochi-check').nth(0).click();
    await k.dlg.locator('label.mochi-check').nth(1).click();
    const post = k.posted('/questions');
    await k.submit().click();
    await post;
    await expect(row(page, prompt)).toBeVisible();
    await expect(row(page, prompt).getByText('Multi-select')).toBeVisible();

    await deleteQuestion(page, prompt);
  });

  test('short answer: accepted-answer chips', async ({ page }) => {
    const k = ui(page);
    // Must not contain "short answer" — getByText is case-insensitive substring
    // and the prompt would collide with the type badge (strict-mode violation).
    const prompt = `E2E text question ${Date.now()}`;

    await page.getByRole('button', { name: 'New question' }).click();
    await k.textIn('Question').fill(prompt);
    await k.pickSel('Type', 'Short answer');
    const chips = k.dlg.locator('input[placeholder="Type an answer and press Enter"]');
    await chips.fill('photosynthesis');
    await chips.press('Enter');
    await chips.fill('quang hợp');
    await chips.press('Enter');
    const post = k.posted('/questions');
    await k.submit().click();
    await post;
    await expect(row(page, prompt)).toBeVisible();
    await expect(row(page, prompt).locator('.mochi-tag', { hasText: 'Short answer' })).toBeVisible();

    await deleteQuestion(page, prompt);
  });
});
