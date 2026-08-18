import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Curriculum CRUD and workbook import.
 *
 * The test env has no ANTHROPIC_API_KEY, so canUseAi=false and nothing here touches the AI paths.
 * Labels are the EN strings, matching the other CRUD specs — the suite runs in the default language.
 *
 * Every test files its own throwaway curriculum. The seeded data deliberately contains none, and
 * `scripts/test-accounts.sql` sweeps `vocab_curricula` on reset, so a failed run cannot leak one into
 * the next.
 */

test.describe('CRUD: vocabulary curriculum', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/vocabulary');
  });

  /**
   * Dismiss the open dialog via its FOOTER Close.
   *
   * The dialog shell renders its own "Close" icon button in the header, so a bare
   * getByRole('button', { name: 'Close' }) matches two elements and fails strict mode.
   */
  const closeDialog = (page: import('@playwright/test').Page) =>
    page.locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();

  /** Create a curriculum through the real dialog and return its name. */
  async function makeCurriculum(page: import('@playwright/test').Page, name: string) {
    const k = ui(page);
    await page.getByRole('button', { name: 'New curriculum' }).click();
    await k.textIn('Name').fill(name);
    const post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
  }

  test('curriculum: create, rename, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E curriculum ${Date.now()}`;
    const renamed = `${name} v2`;

    await makeCurriculum(page, name);
    // The rail chip carries the unit count, which is zero for a brand-new book.
    // `span.m-row` (the chip), not `.m-row` — the rail's own wrapper carries that class too, so
    // the bare selector matches both and fails strict mode. The rest of this spec already scopes
    // to the span; this line was the one that did not.
    await expect(page.getByText(name, { exact: false })).toBeVisible();
    await expect(page.locator('span.m-row', { hasText: name })).toContainText('0 units');

    // Rename through the pencil beside its chip.
    await page
      .locator('span.m-row', { hasText: name })
      .getByRole('button', { name: 'Edit' })
      .click();
    await k.textIn('Name').fill(renamed);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    await expect(page.getByText(renamed, { exact: false })).toBeVisible();

    // Delete, confirming the danger dialog.
    await page
      .locator('span.m-row', { hasText: renamed })
      .getByRole('button', { name: 'Edit' })
      .click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    post = k.posted('/vocabulary');
    await k.confirmDanger('Delete this curriculum?').click();
    await post;
    await expect(page.getByText(renamed, { exact: false })).toHaveCount(0);
  });

  test('curriculum: a grade can be picked, and the rail filters the deck grid', async ({
    page,
  }) => {
    const k = ui(page);
    const name = `E2E grade curriculum ${Date.now()}`;

    await page.getByRole('button', { name: 'New curriculum' }).click();
    await k.textIn('Name').fill(name);
    // Khối is GLOBAL since migration 0049 — this option exists without the school being seeded it,
    // which is the whole point of that migration. The menu is portalled, so locate from `page`.
    await k.pickSel('Grade', 'Khối 9');
    const post = k.posted('/vocabulary');
    await k.submit().click();
    await post;

    // Filtering to a book with no units empties the grid; "All units" brings the seeded decks back.
    await page.getByText(name, { exact: false }).click();
    // Assert the empty STATE, not a card count: the page's own empty panel is a `.mochi-card`
    // too, so counting them can never reach zero.
    await expect(page.getByText('No topics yet')).toBeVisible();
    await page.getByText('All units', { exact: true }).click();
    await expect(page.getByText('Not in a book', { exact: true })).toBeVisible();
  });

  test('import: upload a CSV, review, import, and re-importing adds nothing', async ({ page }) => {
    const k = ui(page);
    const stamp = Date.now();
    const name = `E2E import curriculum ${stamp}`;
    const csv = [
      'unit,unit_name,word,pos,ipa,meaning_vi,example_en,example_answer,topics',
      // The example must CONTAIN the answer, or the parser strips it and flags the row — the
      // answer is the stamped word, so the sentence has to carry the stamp too.
      `1,E2E Unit One,alpha${stamp},n,/ˈælfə/,chữ alpha,The alpha${stamp} comes first.,alpha${stamp},school`,
      `1,E2E Unit One,bravo${stamp},n,/ˈbrɑːvəʊ/,chữ bravo,,,`,
      // No meaning and no definition: must arrive UNCHECKED, so only two of the three import.
      `1,E2E Unit One,charlie${stamp},n,,,,,`,
    ].join('\n');

    await makeCurriculum(page, name);

    await page.getByRole('button', { name: 'Import from a file' }).click();
    await k.pickSel('Into curriculum', name);
    await page.locator('input[type=file]').setInputFiles({
      name: 'e2e-vocab.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });

    // Review phase: one unit, three words, and the meaningless row flagged.
    await expect(page.getByText('Found 1 units and 3 words.')).toBeVisible();
    // Units arrive COLLAPSED (`open: false` in curriculum.tsx), so the per-word issue badges are
    // not on the page until the unit is expanded. The summary above is what shows by default.
    await page.getByRole('button', { name: 'Show words' }).click();
    await expect(page.getByText('No meaning')).toBeVisible();
    // Two of three start checked, so the button offers exactly two.
    await expect(page.getByRole('button', { name: 'Import 2 words' })).toBeVisible();

    let post = k.posted('/vocabulary');
    await page.getByRole('button', { name: 'Import 2 words' }).click();
    await post;
    await expect(page.getByText('Imported 1 units and 2 words.')).toBeVisible();
    await closeDialog(page);

    // The unit became a deck, filed under the book and numbered.
    await page.getByText(name, { exact: false }).click();
    const deck = page.locator('.mochi-card', { hasText: 'E2E Unit One' });
    await expect(deck).toBeVisible();
    await expect(deck).toContainText('2 words');

    // Re-importing the same file extends nothing: importUnits skips words already in the unit.
    await page.getByRole('button', { name: 'Import from a file' }).click();
    await k.pickSel('Into curriculum', name);
    await page.locator('input[type=file]').setInputFiles({
      name: 'e2e-vocab.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    post = k.posted('/vocabulary');
    await page.getByRole('button', { name: 'Import 2 words' }).click();
    await post;
    await expect(page.getByText('Imported 0 units and 0 words.')).toBeVisible();
    await closeDialog(page);

    // Clean up: deleting the book leaves the deck behind, unnumbered — so remove both.
    // Click the TITLE, not the card: Playwright clicks an element's centre, and on a card this
    // short the centre lands on the assign icon, whose handler calls stopPropagation — so the
    // card's own navigate never fires. A real user clicks the body.
    await deck.getByText('E2E Unit One', { exact: true }).click();
    await page.waitForURL(/\/vocabulary\/[^/]+$/);
    await page.goto('/vocabulary');
    await page
      .locator('span.m-row', { hasText: name })
      .getByRole('button', { name: 'Edit' })
      .click();
    // Scoped to the dialog: a deck card is on the page behind it with its own "Delete" icon
    // button, so the page-wide lookup matches two elements here (it does not in the test above,
    // where no deck exists yet).
    await k.dlg.getByRole('button', { name: 'Delete', exact: true }).click();
    const gone = k.posted('/vocabulary');
    await k.confirmDanger('Delete this curriculum?').click();
    await gone;
  });

  test('import: a file with no word column is refused before any POST', async ({ page }) => {
    const k = ui(page);
    const name = `E2E bad header ${Date.now()}`;
    await makeCurriculum(page, name);

    await page.getByRole('button', { name: 'Import from a file' }).click();
    await k.pickSel('Into curriculum', name);
    await page.locator('input[type=file]').setInputFiles({
      name: 'bad.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('unit,nghia\n1,something\n', 'utf8'),
    });
    await expect(page.getByText('No "word" column found. Check the header row.')).toBeVisible();
    // Still on the pick phase: nothing to import, so no import button appeared.
    await expect(page.getByRole('button', { name: /^Import \d+ words$/ })).toHaveCount(0);
  });
});
