import { test, expect } from '@playwright/test';
import { crudGuard, openConfigEntry, signInStaff, ui } from './crud-helpers';

/**
 * System configuration CRUD. Each test creates its own throwaway row —
 * touching the six seeded assessment types would silently retitle seeded
 * score records (FK is ON DELETE SET NULL).
 *
 * /config is a list of rows; each setting's controls live in the modal its row
 * opens (openConfigEntry). That modal is also what scopes the shared button
 * labels — Rename/Deactivate/Delete are identical across all five lists.
 */

test.describe('CRUD: config', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/config');
  });

  test('assessment type: create, rename, deactivate, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E type ${Date.now()}`;
    const card = await openConfigEntry(page, 'Assessment types');

    await card.getByRole('button', { name: 'Add type' }).click();
    await k.dlgOf('Add type').locator('input.mochi-input').fill(name);
    let post = k.posted('/config');
    await k.submit().click(); // "Save" — disabled while the name is blank
    await post;
    const row = (n: string) => card.locator('.lrow', { hasText: n });
    await expect(row(name)).toBeVisible();

    await row(name).getByRole('button', { name: 'Rename' }).click();
    await k.dlgOf('Rename').locator('input.mochi-input').fill(`${name} v2`);
    post = k.posted('/config');
    await k.submit().click();
    await post;
    await expect(row(`${name} v2`)).toBeVisible();

    // Deactivate asks for confirmation; the badge flips to Inactive.
    await row(`${name} v2`).getByRole('button', { name: 'Deactivate' }).click();
    post = k.posted('/config');
    await k.dlgOf('Deactivate').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(row(`${name} v2`).getByText('Inactive')).toBeVisible();

    await row(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/config');
    await k.confirmDanger('Delete type?').click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);
  });

  test('grade level: create, rename, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E level ${Date.now()}`;
    const card = await openConfigEntry(page, 'Grade levels');

    await card.getByRole('button', { name: 'Add grade level' }).click();
    await k.dlgOf('Add grade level').locator('input.mochi-input').fill(name);
    let post = k.posted('/config');
    await k.submit().click();
    await post;
    const row = (n: string) => card.locator('.lrow', { hasText: n });
    await expect(row(name)).toBeVisible();

    await row(name).getByRole('button', { name: 'Rename' }).click();
    await k.dlgOf('Rename').locator('input.mochi-input').fill(`${name} v2`);
    post = k.posted('/config');
    await k.submit().click();
    await post;
    await expect(row(`${name} v2`)).toBeVisible();

    await row(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/config');
    await k.confirmDanger('Delete grade level?').click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);
  });

  /**
   * The row itself is the whole contract of the reworked page: it must say what the setting is
   * currently set to without being opened, and it must open on Enter as well as on click.
   */
  test('every setting is a row that opens into its modal', async ({ page }) => {
    const row = (title: string) => page.locator(`.cfg-row:has(.lrow__title:text-is("${title}"))`);

    // Eighteen settings, grouped. The summary is the point — it is what replaces scrolling.
    // This count is deliberately exact: adding a setting without a row would otherwise pass
    // silently. Bump it when you add one (13 -> 16 came with check-in and túi mù, 17 with
    // the pronunciation forgiveness curve, 18 with the vocabulary deck-card style).
    await expect(page.locator('.cfg-row')).toHaveCount(18);
    await expect(row('Assessment types').locator('.cfg-row__value')).toHaveText(/of \d+ active/);
    await expect(row('Ranking weights').locator('.cfg-row__value')).toHaveText(/^\d+ \/ \d+$/);

    await row('Scrollbar style').focus();
    await page.keyboard.press('Enter');
    const dlg = page.locator('.m-dialog:has(.m-dialog__title:text-is("Scrollbar style"))');
    await expect(dlg).toBeVisible();
    // The active preset in the modal must be the one the row advertised.
    await expect(dlg.locator('button.preset.preset--sb.is-active')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });

  /**
   * The vocabulary deck-card style, the third `ui-prefs` preset alongside the scrollbar and the
   * phone's tab bar.
   *
   * What is actually under test is the WIRING, not the CSS: the preset is stored school-wide and
   * applied as `data-vocab-card` on <html>, so the assertion is that the attribute follows the
   * click, survives a reload (which proves it was written, not just previewed optimistically),
   * and that the row's summary agrees with the active preset in the modal.
   *
   * Restores `band` at the end. It is the default, and the value is school-wide — left on `full`
   * it would silently restyle /vocabulary for every other spec in the run.
   */
  test('vocabulary deck cards: pick a style, and it sticks school-wide', async ({ page }) => {
    const k = ui(page);
    const row = page.locator('.cfg-row:has(.lrow__title:text-is("Vocabulary deck cards"))');
    const html = page.locator('html');

    await expect(row.locator('.cfg-row__value')).toHaveText('Colour band');
    await expect(html).toHaveAttribute('data-vocab-card', 'band');

    const card = await openConfigEntry(page, 'Vocabulary deck cards');
    await expect(card.locator('button.preset.preset--vc')).toHaveCount(3);
    await expect(card.locator('button.preset.preset--vc.is-active')).toHaveCount(1);

    // Picking previews instantly AND saves in the same click, like the scrollbar preset.
    let post = k.posted('/config');
    await card.getByRole('button', { name: 'Full colour' }).click();
    await expect(html).toHaveAttribute('data-vocab-card', 'full');
    await post;

    await page.reload();
    await expect(html).toHaveAttribute('data-vocab-card', 'full');
    await expect(row.locator('.cfg-row__value')).toHaveText('Full colour');

    // ---- The grid actually honours it: the deck card carries the class the CSS keys off. ----
    await page.goto('/vocabulary');
    await expect(html).toHaveAttribute('data-vocab-card', 'full');
    await expect(page.locator('.mochi-card.topic-card').first()).toBeVisible();

    // ---- Put the school back on the default. ----
    await page.goto('/config');
    const back = await openConfigEntry(page, 'Vocabulary deck cards');
    post = k.posted('/config');
    await back.getByRole('button', { name: 'Colour band' }).click();
    await post;
    await page.reload();
    await expect(html).toHaveAttribute('data-vocab-card', 'band');
  });
});
