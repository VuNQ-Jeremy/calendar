import { test, expect } from '@playwright/test';
import { crudGuard, openConfigEntry, signInStaff, ui } from './crud-helpers';

/**
 * Check-in activity types (the kiosk's managed enum) and the túi mù settings card.
 * Same row-and-modal contract as the other /config lists; the activity modal adds an
 * icon picker and a color picker on top of the shared name/deactivate/delete flow.
 */

test.describe('CRUD: check-in config', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/config');
  });

  test('activity type: create, rename, deactivate, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E activity ${Date.now()}`;
    const card = await openConfigEntry(page, 'Check-in activities');

    await card.getByRole('button', { name: 'Add activity' }).click();
    const dlg = k.dlgOf('Add activity');
    await dlg.locator('input.mochi-input').fill(name);
    // Pick a non-default icon and color so the update path carries all three fields.
    await dlg.getByRole('button', { name: 'book', exact: true }).click();
    await dlg.locator('.m-swatch').nth(2).click();
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

    await row(`${name} v2`).getByRole('button', { name: 'Deactivate' }).click();
    post = k.posted('/config');
    await k.dlgOf('Deactivate').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(row(`${name} v2`).getByText('Inactive')).toBeVisible();

    await row(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/config');
    await k.dlgOf('Delete this activity?').getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);
  });

  test('túi mù settings: earn mode, tiers and visibility save together', async ({ page }) => {
    const k = ui(page);
    const card = await openConfigEntry(page, 'Mystery bags (túi mù)');

    // Flip the earn mode, edit the first tier's label, and toggle one visibility switch.
    await card.getByRole('button', { name: 'Each full phase = 1 bag' }).click();
    // Tier rows are [bags, label] pairs after the earn-mode chips; edit the first label.
    await card
      .locator('.m-row', { hasText: 'Gift' })
      .first()
      .locator('input.mochi-input')
      .nth(1)
      .fill('E2E quà nhỏ');
    await card.getByText('Rankings', { exact: true }).click();

    const post = k.posted('/config');
    await card.getByRole('button', { name: 'Save' }).click();
    await post;

    // Reopen: the modal must read back what was saved, not defaults.
    await page.keyboard.press('Escape');
    const card2 = await openConfigEntry(page, 'Mystery bags (túi mù)');
    await expect(
      card2.locator('.m-row', { hasText: 'Gift' }).first().locator('input.mochi-input').nth(1),
    ).toHaveValue('E2E quà nhỏ');

    // Restore defaults so reruns start clean (the reset sweep also drops the settings row).
    await card2.getByRole('button', { name: 'Perfect day = 1 bag' }).click();
    await card2
      .locator('.m-row', { hasText: 'Gift' })
      .first()
      .locator('input.mochi-input')
      .nth(1)
      .fill('Quà nhỏ');
    await card2.getByText('Rankings', { exact: true }).click();
    const post2 = k.posted('/config');
    await card2.getByRole('button', { name: 'Save' }).click();
    await post2;
  });
});
