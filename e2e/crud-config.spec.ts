import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * System configuration CRUD. Each test creates its own throwaway row —
 * touching the six seeded assessment types would silently retitle seeded
 * score records (FK is ON DELETE SET NULL). The three cards share button
 * labels (Rename/Deactivate/Delete), so everything is scoped to its card.
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
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Assessment types' }),
    });

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
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Grade levels' }),
    });

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
});
