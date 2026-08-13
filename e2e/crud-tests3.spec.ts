import { test, expect, type Page } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent, ui } from './crud-helpers';

/**
 * The deep test-taking intents: CSV question import, a full online-test round
 * trip (student sits it, staff grades the essay, then allows a retake), and
 * the paper score grid. The online spec spans two browser contexts — staff in
 * the default page, the seeded student (Leo Park, Biology 9A) in a second.
 */

test.describe('CRUD: online test round trip and paper scores', () => {
  crudGuard();

  /** Pick a date in an MDatePicker by ISO day, hopping one month if needed. */
  async function pickDay(page: Page, label: string, iso: string) {
    await page
      .locator(`.mochi-field:has(> label.mochi-field__label:text-is("${label}"))`)
      .locator('button[aria-haspopup="dialog"]')
      .click();
    const day = page.locator(`.m-datepicker__day[aria-label="${iso}"]`);
    if ((await day.count()) === 0) {
      await page.getByRole('button', { name: 'Next month' }).click();
    }
    await day.click();
  }

  test('import CSV, publish online, student sits it, grade, allow retake', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const k = ui(page);
    const testName = `E2E online test ${Date.now()}`;
    await signInStaff(page);

    // Create the test and switch it online with a future close.
    await page.goto('/tests');
    await page.getByRole('button', { name: 'New test' }).click();
    await k.textIn('Test name').fill(testName);
    await k.submit().click();
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const detailPath = new URL(page.url()).pathname;

    const on = k.on(page); // setup fields live on the page, not in a dialog
    await on.pickSel('Class', 'Biology 9A');
    await on.pickSel('Delivery', 'Online');
    // Closes = tomorrow 11:45 pm ICT; Opens stays blank = open immediately.
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA');
    await pickDay(page, 'Closes', tomorrow);
    await page
      .locator('.mochi-field:has(> label.mochi-field__label:text-is("Closes"))')
      .locator('button[role="combobox"]')
      .click();
    await page.locator('[role="listbox"] [role="option"]', { hasText: '11:45 pm' }).click();
    await on.textIn('Time limit (minutes)').fill('30');
    await on.textIn('Instructions').fill('E2E: answer what you can.');
    let post = k.posted(detailPath);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await post;

    // Import the 5-question CSV fixture straight onto the test.
    await page.getByRole('tab', { name: 'Questions' }).click();
    await page.getByRole('button', { name: 'Import from file' }).click();
    await k.dlg.locator('input[type="file"]').setInputFiles('test/fixtures/question-csv/clean.csv');
    post = k.posted(detailPath);
    await k.dlg.getByRole('button', { name: 'Import 5 questions' }).click();
    await post;
    await expect(page.getByText('5 questions · 5 points')).toBeVisible();

    // Publish.
    await page.getByRole('tab', { name: 'Setup' }).click();
    post = k.posted(detailPath);
    await page.getByRole('button', { name: 'Publish' }).click();
    await post;
    await expect(page.getByRole('button', { name: 'Back to draft' })).toBeVisible();

    // Student context: sit the test, answer only the essay, submit.
    const ctx = await browser.newContext();
    const student = await ctx.newPage();
    await signInStudent(student);
    await student.goto('/my-tests');
    const card = student.locator('.mochi-card', { hasText: testName });
    await expect(card).toContainText('Open until');
    // Two Start buttons: the list card's (navigates to the detail page)...
    await card.getByRole('button', { name: 'Start' }).click();
    await student.waitForURL(/\/my-tests\/.+/);
    // ...and the detail page's, which actually starts the attempt.
    await student.getByRole('button', { name: 'Start' }).click();

    // The essay is the only question type rendered as a textarea.
    const answer = student.locator('textarea.mochi-input').first();
    await expect(answer).toBeVisible({ timeout: 15_000 });
    await answer.fill('E2E essay answer: I like biology.');
    await expect(student.getByText('Saved ✓')).toBeVisible(); // 800ms autosave
    await student.getByRole('button', { name: 'Submit' }).click();
    const submitted = student.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/my-tests/') && r.ok(),
    );
    await student
      .locator('.m-dialog:has(.m-dialog__title:text-is("Submit"))')
      .locator('.mochi-btn.is-primary')
      .click();
    await submitted;
    await expect(student.getByText('Awaiting grading')).toBeVisible();
    await ctx.close();

    // Staff: grade the essay.
    await page.getByRole('tab', { name: 'Results' }).click();
    const row = page.locator('.lrow', { hasText: 'Leo Park' });
    await expect(row.getByText('Needs grading')).toBeVisible();
    await row.getByRole('button', { name: 'Grade' }).click();
    const gradeDlg = k.dlgOf('Results & grading');
    const essayCard = gradeDlg.locator('.mochi-card', { hasText: 'Manual marking' });
    await essayCard.locator('input[type="number"]').fill('1');
    await essayCard
      .locator('input.mochi-input[placeholder="Feedback for this question"]')
      .fill('Nice answer');
    post = k.posted(detailPath);
    await gradeDlg.getByRole('button', { name: 'Save grades' }).click();
    await post;
    await expect(gradeDlg.getByText('Grades saved ✓')).toBeVisible();
    // Two Close buttons in this dialog: the X icon and the footer ghost.
    await gradeDlg.locator('button.mochi-btn', { hasText: 'Close' }).click();
    await expect(row.getByText('Graded', { exact: true })).toBeVisible();
    await expect(row.getByText(/Final: [\d.]+\/10/)).toBeVisible();

    // Allow a retake — deletes the attempt and its gradebook entry.
    await row.getByRole('button', { name: 'Allow retake' }).click();
    post = k.posted(detailPath);
    await k.dlgOf('Allow retake').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(row.getByText('Not started')).toBeVisible();

    // Cleanup: no attempts remain, so the test deletes cleanly...
    await page.getByRole('tab', { name: 'Setup' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await k.dlg.getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL(/\/tests(\?|$)/, { timeout: 15_000 });

    // ...and the imported questions leave via Wipe bank (count-agnostic — a
    // prior failed spec may have leaked questions).
    await page.goto('/questions');
    await page.getByRole('button', { name: 'Wipe bank' }).click();
    post = k.posted('/questions');
    await page
      .locator('.m-dialog', { has: page.getByText(/^Delete all \d+ questions\?$/) })
      .locator('.mochi-btn.is-danger')
      .click();
    await post;
    await expect(page.getByRole('button', { name: 'Wipe bank' })).toHaveCount(0);
  });

  test('paper score grid: autosave a score, clear it again', async ({ page }) => {
    const k = ui(page);
    const testName = `E2E paper grid ${Date.now()}`;
    await signInStaff(page);

    // A draft paper test with a class is enough for the grid to render.
    await page.goto('/tests');
    await page.getByRole('button', { name: 'New test' }).click();
    await k.textIn('Test name').fill(testName);
    await k.submit().click();
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const detailPath = new URL(page.url()).pathname;
    await k.on(page).pickSel('Class', 'Biology 9A');
    let post = k.posted(detailPath);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await post;

    await page.getByRole('tab', { name: 'Results' }).click();
    const row = page.locator('.lrow', { hasText: 'Leo Park' });
    // Score is an unlabelled combobox in the row — posts on the same tick.
    await row.locator('.hw-grade-score button.m-select__trigger').click();
    post = k.posted(detailPath);
    await page
      .locator('[role="listbox"] [role="option"]')
      .getByText('8.5', { exact: true })
      .click();
    await post;
    await expect(page.getByText('Saved ✓')).toBeVisible();
    await expect(row.locator('.m-select__value')).toHaveText('8.5');

    // Clearing (—) with no comment deletes the synthetic attempt again.
    await row.locator('.hw-grade-score button.m-select__trigger').click();
    post = k.posted(detailPath);
    await page.locator('[role="listbox"] [role="option"]').getByText('—', { exact: true }).click();
    await post;

    // Cleanup.
    await page.getByRole('tab', { name: 'Setup' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await k.dlg.getByRole('button', { name: 'Delete' }).click();
    await page.waitForURL(/\/tests(\?|$)/, { timeout: 15_000 });
  });
});
