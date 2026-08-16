import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * The shared material library (feedback F-21).
 *
 * A material belongs to no class of its own: `class_materials` links it to as many as you like,
 * and attaching happens only from the class detail modal. The regression this guards is the old
 * single-owner behaviour, where attaching to a second class silently MOVED the material off the
 * first one.
 *
 * The class card opens its detail modal on click, and that modal's title is the class name — so
 * everything here is scoped with `dlgOf(name)` rather than the bare `.m-dialog`.
 */

test.describe('CRUD: class materials', () => {
  crudGuard();

  test('one material, two classes, then detached from one', async ({ page }) => {
    const k = ui(page);
    const title = `E2E shared material ${Date.now()}`;
    const card = () => page.locator('.mochi-card', { hasText: title });
    const openClass = async (name: string) => {
      await page.locator('.mochi-card', { hasText: name }).click();
      const dlg = k.dlgOf(name);
      await expect(dlg).toBeVisible();
      return dlg;
    };

    // --- Create it on the materials page, which is now plain CRUD ---
    await signInStaff(page);
    await page.goto('/materials');
    await page.getByRole('button', { name: 'Add material' }).click();
    // The relationship editors are gone: no owning class, no scope.
    await expect(k.field('Class')).toHaveCount(0);
    await expect(k.field('Scope')).toHaveCount(0);
    await k.textIn('Title').fill(title);
    await k.pickSel('Type', 'Link'); // switches the file zone to a URL field
    await k.textIn('URL').fill('https://example.com/e2e-shared');
    const created = k.posted('/materials');
    await k.submit().click();
    await created;
    await expect(card()).toBeVisible();

    // --- Attach the same material to two classes ---
    await page.goto('/classes');
    for (const cls of ['Biology 9A', 'Algebra II']) {
      const dlg = await openClass(cls);
      await dlg.locator('.tokensearch__input').fill(title);
      const attached = k.posted('/class-materials');
      // The dropdown is portalled to document.body, so its rows are located from `page`.
      await page
        .locator('.tokensearch__opt', { hasText: title })
        .getByRole('button', { name: 'Add' })
        .click();
      await attached;
      await expect(dlg.locator('.lrow', { hasText: title })).toBeVisible();
      await dlg.getByRole('button', { name: 'Close' }).click();
    }

    // --- The first class kept it. Sharing, not moving: this is the F-21 regression ---
    await page.reload();
    const bio = await openClass('Biology 9A');
    await expect(bio.locator('.lrow', { hasText: title })).toBeVisible();
    await bio.getByRole('button', { name: 'Close' }).click();

    // --- Both classes show as read-only chips on the library page ---
    await page.goto('/materials');
    await expect(card()).toContainText('Biology 9A');
    await expect(card()).toContainText('Algebra II');

    // --- Detaching from one leaves the other link alone ---
    await page.goto('/classes');
    const algebra = await openClass('Algebra II');
    const detached = k.posted('/class-materials');
    await algebra
      .locator('.lrow', { hasText: title })
      .getByRole('button', { name: 'Delete' })
      .click();
    await detached;
    await expect(algebra.locator('.lrow', { hasText: title })).toHaveCount(0);
    await algebra.getByRole('button', { name: 'Close' }).click();

    await page.goto('/materials');
    await expect(card()).toContainText('Biology 9A');
    await expect(card()).not.toContainText('Algebra II');

    // --- Cleanup: deleting the material takes its remaining link with it (FK cascade) ---
    const removed = k.posted('/materials');
    await card().getByRole('button', { name: 'Delete' }).click(); // materials delete has no confirm
    await removed;
    await expect(card()).toHaveCount(0);

    await page.goto('/classes');
    const bioAfter = await openClass('Biology 9A');
    await expect(bioAfter.locator('.lrow', { hasText: title })).toHaveCount(0);
  });
});
