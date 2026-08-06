import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Question bank and test lifecycles. Essay questions are used throughout
 * because they need no options and no answer key — the minimal valid question.
 */

test.describe('CRUD: question bank and tests', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
  });

  test('question: create, edit, delete', async ({ page }) => {
    const k = ui(page);
    const prompt = `E2E essay question ${Date.now()}`;
    await page.goto('/questions');

    await page.getByRole('button', { name: 'New question' }).click();
    await k.textIn('Question').fill(prompt);
    await k.pickSel('Type', 'Essay');
    let post = k.posted('/questions');
    await k.submit().click(); // "Save"
    await post;

    const row = (p: string) => page.locator('.mochi-card', { hasText: p });
    await expect(row(prompt)).toBeVisible();

    await row(prompt).getByRole('button', { name: 'Edit' }).click();
    await k.textIn('Question').fill(`${prompt} v2`);
    post = k.posted('/questions');
    await k.submit().click();
    await post;
    await expect(row(`${prompt} v2`)).toBeVisible();

    await row(`${prompt} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/questions');
    await k.dlgOf('Delete this question?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(row(`${prompt} v2`)).toHaveCount(0);
  });

  test('test: create, attach a question, publish, unpublish, delete', async ({ page }) => {
    const k = ui(page);
    const stamp = Date.now();
    const prompt = `E2E test question ${stamp}`;
    const testName = `E2E paper test ${stamp}`;

    // A test cannot be published empty, so seed the bank with one essay question.
    await page.goto('/questions');
    await page.getByRole('button', { name: 'New question' }).click();
    await k.textIn('Question').fill(prompt);
    await k.pickSel('Type', 'Essay');
    let post = k.posted('/questions');
    await k.submit().click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: prompt })).toBeVisible();

    // Create the test (paper delivery avoids the closing-time requirement).
    // Success auto-navigates to the new test's detail page.
    await page.goto('/tests');
    await page.getByRole('button', { name: 'New test' }).click();
    await k.textIn('Test name').fill(testName);
    await k.submit().click();
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const detailPath = new URL(page.url()).pathname;

    // Attach the question and save the list.
    await page.getByRole('tab', { name: 'Questions' }).click();
    await page.locator('.lrow', { hasText: prompt }).getByRole('button', { name: 'Add' }).click();
    post = k.posted(detailPath);
    await page.getByRole('button', { name: 'Save questions' }).click();
    await post;

    // Publish, then pull back to draft.
    await page.getByRole('tab', { name: 'Setup' }).click();
    post = k.posted(detailPath);
    await page.getByRole('button', { name: 'Publish' }).click();
    await post;
    await expect(page.getByRole('button', { name: 'Back to draft' })).toBeVisible();

    post = k.posted(detailPath);
    await page.getByRole('button', { name: 'Back to draft' }).click();
    await post;
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();

    // Delete the test (confirm dialog) — the action redirects to /tests.
    await page.getByRole('button', { name: 'Delete' }).click();
    await k.dlg.getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL(/\/tests(\?|$)/, { timeout: 15_000 });
    await expect(page.locator('.mochi-card h3', { hasText: testName })).toHaveCount(0);

    // Cleanup: the question is unused again, so it can be deleted.
    await page.goto('/questions');
    const qRow = page.locator('.mochi-card', { hasText: prompt });
    await qRow.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/questions');
    await k.dlgOf('Delete this question?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(qRow).toHaveCount(0);
  });
});
