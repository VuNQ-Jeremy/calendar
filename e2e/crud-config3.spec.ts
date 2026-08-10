import { test, expect } from '@playwright/test';
import { crudGuard, openConfigEntry, signInStaff, ui } from './crud-helpers';

/**
 * Class levels (trình độ) — the managed enum that pairs with a grade level to form the cohort a
 * class competes in on /rankings — and subjects (môn học). Their own file rather than growing
 * crud-config, matching the existing crud-config2 split. The seeded rows (Cơ bản / Nâng cao, and
 * the subjects derived from existing classes) are re-asserted by scripts/test-accounts.sql on
 * every reset and must be left alone: the class and rankings specs pick them from the class form.
 */

test.describe('CRUD: class levels and subjects', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/config');
  });

  test('subject: create, rename, deactivate, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E subject ${Date.now()}`;
    const card = await openConfigEntry(page, 'Subjects');

    await card.getByRole('button', { name: 'Add subject' }).click();
    await k.dlgOf('Add subject').locator('input.mochi-input').fill(name);
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
    await k.dlgOf('Delete subject?').getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);

    // The subjects seeded from the existing classes must survive: the class form picks from them.
    await expect(row('Science')).toBeVisible();
  });

  test('class level: create, rename, deactivate, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E clevel ${Date.now()}`;
    const card = await openConfigEntry(page, 'Class levels');

    await card.getByRole('button', { name: 'Add class level' }).click();
    await k.dlgOf('Add class level').locator('input.mochi-input').fill(name);
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

    // Deactivate asks for confirmation; the badge flips to Inactive. A deactivated level stays
    // pickable only on classes that already point at it — see the class form's filter.
    await row(`${name} v2`).getByRole('button', { name: 'Deactivate' }).click();
    post = k.posted('/config');
    await k.dlgOf('Deactivate').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(row(`${name} v2`).getByText('Inactive')).toBeVisible();

    await row(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/config');
    await k.dlgOf('Delete class level?').getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);

    // The seeded pair must survive: the class form requires a trình độ, so an empty table
    // would dead-end every later spec that creates a class.
    await expect(row('Cơ bản')).toBeVisible();
    await expect(row('Nâng cao')).toBeVisible();
  });
});
