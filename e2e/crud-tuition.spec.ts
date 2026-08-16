import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Tuition lifecycle on June 2026 — the one month the seed data gives
 * attendance for (class Biology 9A, three students on 2026-06-22). Seed wipes
 * class_prices, so the spec creates its own price, then records a payment and
 * exercises close/reopen. Requires an Admin account (dev@mochi.edu is one).
 */

test.describe('CRUD: tuition', () => {
  crudGuard();

  test('price, payment, close month, reopen month', async ({ page }) => {
    const k = ui(page);
    await signInStaff(page);
    await page.goto('/tuition/2026-06');

    // Fresh seed: attendance exists but no price → the month is empty and
    // closing is refused until a price is set.
    await expect(page.getByText('No price set for Biology 9A')).toBeVisible();

    // Set a per-session price for Biology 9A (nested modal titled by class).
    await page.getByRole('button', { name: 'Class prices' }).click();
    await k
      .dlgOf('Class prices')
      .locator('.lrow', { hasText: 'Biology 9A' })
      .getByRole('button', { name: 'Set a price' })
      .click();
    const priceDlg = k.dlgOf('Biology 9A');
    await priceDlg.locator('input.mochi-input').first().fill('150000');
    let post = k.posted('/tuition/2026-06');
    await priceDlg.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    await k.dlgOf('Class prices').getByRole('button', { name: 'Close' }).click();

    // The three June students now bill; record a full payment for Leo Park.
    const leo = page.locator('.lrow', { hasText: 'Leo Park' });
    await expect(leo).toBeVisible();
    await leo.getByRole('button', { name: 'Record payment' }).click();
    post = k.posted('/tuition/2026-06');
    await k.dlgOf('Record payment').locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    await expect(leo.getByText('Paid in full')).toBeVisible();

    // A discount for the second student. The sign is a dropdown, not a typed minus: the amount
    // field takes digits only (a '-' never survived typing, and phone keypads have no minus key).
    const mia = page.locator('.lrow', { hasText: 'Mia Chen' });
    await mia.getByRole('button', { name: 'Adjustment' }).click();
    const adjDlg = k.dlgOf('Adjustment');
    const adj = k.on(adjDlg);
    await adj.pickSel('Type', 'Discount — take off');
    await adj.textIn('Adjustment').fill('50000');
    // "Other…" swaps the preset list for a free-text box, which has no label of its own.
    await adj.pickSel('Reason', 'Other…');
    await adjDlg.locator('input.mochi-input[placeholder="Reason"]').fill('E2E discount');
    post = k.posted('/tuition/2026-06');
    await adjDlg.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    // Anchor on the labelled line — a bare "50.000" is a substring of the
    // "150.000 ₫" amounts elsewhere in the row.
    await expect(mia.getByText(/Adjustment: -50\.000/)).toBeVisible();

    // Close the month (freezes amounts), then reopen it.
    await page.getByRole('button', { name: 'Close month' }).click();
    post = k.posted('/tuition/2026-06');
    await k.dlgOf('Close June 2026?').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(page.getByRole('button', { name: 'Reopen month' })).toBeVisible();

    await page.getByRole('button', { name: 'Reopen month' }).click();
    post = k.posted('/tuition/2026-06');
    await k.dlgOf('Reopen June 2026?').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(page.getByRole('button', { name: 'Close month' })).toBeVisible();

    // Delete the price again — the open month goes back to unpriced.
    await page.getByRole('button', { name: 'Class prices' }).click();
    await k
      .dlgOf('Class prices')
      .locator('.lrow', { hasText: 'Biology 9A' })
      .getByRole('button', { name: 'Delete' })
      .click();
    post = k.posted('/tuition/2026-06');
    // The confirm nests inside the Class-prices dialog's DOM, so a title-scoped
    // dialog locator matches both — the danger class is unique to the confirm.
    await k.dlgOf('Delete this price?').locator('.mochi-btn.is-danger').first().click();
    await post;
    await k.dlgOf('Class prices').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('No price set for Biology 9A')).toBeVisible();
  });
});
