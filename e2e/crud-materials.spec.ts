import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Materials CRUD — one lifecycle per storage shape: a URL material (link) and
 * an R2 file upload. NOTE: materials delete has no confirmation dialog.
 */

test.describe('CRUD: materials', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/materials');
  });

  test('link material: create, edit, delete', async ({ page }) => {
    const k = ui(page);
    const title = `E2E link material ${Date.now()}`;
    const card = (t: string) => page.locator('.mochi-card', { hasText: t });

    await page.getByRole('button', { name: 'Add material' }).click();
    // The library is CRUD-only since F-21: no owning class, no scope. Attaching lives on the
    // class page and the event dialog (e2e/crud-class-materials.spec.ts, crud-event-tabs.spec.ts).
    await expect(k.field('Class')).toHaveCount(0);
    await expect(k.field('Scope')).toHaveCount(0);
    await k.textIn('Title').fill(title);
    await k.pickSel('Type', 'Link'); // switches the file zone to a URL field
    await k.textIn('URL').fill('https://example.com/e2e');
    let post = k.posted('/materials');
    await k.submit().click(); // "Save"
    await post;
    await expect(card(title)).toBeVisible();
    await expect(card(title).locator('a', { hasText: 'Open link' })).toBeVisible();

    // Favorite star: its own one-field update intent, toggling .is-on.
    let fav = k.posted('/materials');
    await card(title).locator('.starbtn').click();
    await fav;
    await expect(card(title).locator('.starbtn')).toHaveClass(/is-on/);
    fav = k.posted('/materials');
    await card(title).locator('.starbtn').click();
    await fav;
    await expect(card(title).locator('.starbtn')).not.toHaveClass(/is-on/);

    await card(title).getByRole('button', { name: 'Edit' }).click();
    await k.textIn('Title').fill(`${title} v2`);
    post = k.posted('/materials');
    await k.submit().click();
    await post;
    await expect(card(`${title} v2`)).toBeVisible();

    post = k.posted('/materials');
    await card(`${title} v2`).getByRole('button', { name: 'Delete' }).click(); // no confirm
    await post;
    await expect(card(`${title} v2`)).toHaveCount(0);
  });

  test('file material: upload to R2, download link appears, delete', async ({ page }) => {
    const k = ui(page);
    const title = `E2E file material ${Date.now()}`;
    const card = page.locator('.mochi-card', { hasText: title });

    await page.getByRole('button', { name: 'Add material' }).click();
    await k.textIn('Title').fill(title);
    // Default type "Notes" shows the file drop zone; the input is display:none,
    // so setInputFiles (not click) is the way in.
    await k.dlg.locator('input[type="file"]').setInputFiles({
      name: 'e2e-note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello from the e2e suite'),
    });
    const post = k.posted('/materials');
    await k.submit().click();
    await post;
    await expect(card).toBeVisible();
    await expect(card.locator('a', { hasText: 'Download' })).toBeVisible();

    // Deleting also removes the R2 object server-side.
    const del = k.posted('/materials');
    await card.getByRole('button', { name: 'Delete' }).click();
    await del;
    await expect(card).toHaveCount(0);
  });
});
