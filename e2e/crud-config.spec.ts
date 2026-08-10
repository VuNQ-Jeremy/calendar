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
    await k.dlgOf('Delete type?').getByRole('button', { name: 'Delete' }).click();
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
    await k.dlgOf('Delete grade level?').getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);
  });

  /**
   * The row itself is the whole contract of the reworked page: it must say what the setting is
   * currently set to without being opened, and it must open on Enter as well as on click.
   */
  test('every setting is a row that opens into its modal', async ({ page }) => {
    const row = (title: string) => page.locator(`.cfg-row:has(.lrow__title:text-is("${title}"))`);

    // Eleven settings, grouped. The summary is the point — it is what replaces scrolling.
    await expect(page.locator('.cfg-row')).toHaveCount(11);
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
});
