import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Full invite lifecycle across two browser contexts: staff generates a
 * student code, an anonymous visitor redeems it on /login and lands signed-in
 * on the dashboard. Redemption creates a fresh student + account; the student
 * row is cleaned up here, and test-accounts.sql sweeps the leftover accounts
 * on every reset.
 */

test.describe('CRUD: invite redemption', () => {
  crudGuard();

  test('generate a code, redeem it, new student is signed in', async ({ page, browser }) => {
    const k = ui(page);
    const stamp = Date.now();
    const studentName = `E2E redeemed ${stamp}`;

    // Staff: mint a student invite and read the code off the dialog.
    await signInStaff(page);
    await page.goto('/people');
    await page.getByRole('button', { name: 'Generate invite' }).click();
    const dlg = k.dlgOf('Generate invite code');
    const post = k.posted('/people');
    await dlg.getByRole('button', { name: 'Generate code' }).click();
    await post;
    // The code renders as a plain styled div (mono font via inline style only).
    const code = (await dlg.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/).innerText()).trim();
    expect(code).toHaveLength(7);
    await dlg.getByRole('button', { name: 'Done' }).click();

    // Anonymous visitor in a second context redeems it.
    const ctx = await browser.newContext();
    const visitor = await ctx.newPage();
    await visitor.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await visitor.goto('/login');
    await visitor.getByRole('button', { name: 'I have an invite code' }).click();
    await visitor.locator('input.auth-code').fill(code);
    await visitor.getByRole('button', { name: 'Continue' }).click();
    await expect(visitor.locator('h2.auth-title')).toHaveText(/invited/);

    await visitor.fill('input[name="name"]', studentName);
    await visitor.fill('input[name="email"]', `e2e-redeem-${stamp}@example.com`);
    await visitor.fill('input[name="password"]', 'e2e-pass-123');
    await visitor.click('form[action="/login"] button[type="submit"]'); // "Join Mochi"
    // A redeemed student account lands on /vocabulary (students always do).
    await visitor.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });
    await expect(visitor.locator('.sb')).toBeVisible();
    await ctx.close();

    // The used invite now shows as consumed / the student row exists — clean
    // the student up through the UI (accounts are swept by the DB reset).
    await page.goto('/people');
    const row = page.locator('.lrow', { hasText: studentName });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();
    const del = k.posted('/people');
    await k.dlgOf('Remove student?').locator('.mochi-btn.is-danger').click();
    await del;
    await expect(row).toHaveCount(0);
  });
});
