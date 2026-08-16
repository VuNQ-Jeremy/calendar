import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Feedback board CRUD and the profile updates. The password-change test
 * reverts itself in a finally block; the server keeps the session performing
 * the change alive (it revokes only OTHER sessions of the account), and the
 * staging DB reset re-seeds the password hash anyway if a run dies midway.
 */

test.describe('CRUD: feedback and profile', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
  });

  test('feedback: create, resolve, edit, delete', async ({ page }) => {
    const k = ui(page);
    const msg = `E2E feedback ${Date.now()}`;
    await page.goto('/feedback');
    const card = (m: string) => page.locator('.kcard', { hasText: m });
    const column = (title: string) =>
      page.locator('.m-board__col').filter({
        has: page.locator('.m-board__title', { hasText: title }),
      });

    await page.getByRole('button', { name: 'Log feedback' }).click();
    await k.textIn('Your feedback').fill(msg);
    let post = k.posted('/feedback');
    await k.submit().click(); // "Send feedback"
    await post;
    await expect(column('New').locator('.kcard', { hasText: msg })).toBeVisible();

    // Every report gets a short handle ("F-12") to quote — the id itself is a UUID, which is
    // useless in conversation. Assert the shape, not the number: it counts up per environment.
    await expect(card(msg).locator('.kcard__ref')).toHaveText(/^F-\d+$/);

    // A long column scrolls inside itself: the card list is the scroll box and the
    // page around it stays put, so every column's drop target keeps its place.
    const overflow = await column('New')
      .locator('.m-board__body')
      .evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflow).toBe('auto');
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
    ).toBe(true);

    // Status toggle moves the card to the Resolved column.
    post = k.posted('/feedback');
    await card(msg).getByRole('button', { name: 'Mark resolved' }).click();
    await post;
    await expect(column('Resolved').locator('.kcard', { hasText: msg })).toBeVisible();

    await card(msg).getByRole('button', { name: 'Edit' }).click();
    await k.textIn('Your feedback').fill(`${msg} v2`);
    post = k.posted('/feedback');
    await k.submit().click(); // "Save"
    await post;
    await expect(card(`${msg} v2`)).toBeVisible();

    // Feedback delete has NO confirmation dialog.
    post = k.posted('/feedback');
    await card(`${msg} v2`).getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(card(`${msg} v2`)).toHaveCount(0);
  });

  test('profile: update phone, persist across reload, clear again', async ({ page }) => {
    const k = ui(page);
    const phone = `09${String(Date.now()).slice(-8)}`;
    await page.goto('/profile');
    const phoneInput = page.locator('input[type="tel"]');

    await phoneInput.fill(phone);
    let post = k.posted('/profile');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await post;

    // The "Saved ✓" flip is optimistic — reload to prove persistence.
    await page.reload();
    await expect(phoneInput).toHaveValue(phone);

    // Restore the seeded empty phone.
    await phoneInput.fill('');
    post = k.posted('/profile');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await post;
    await page.reload();
    await expect(phoneInput).toHaveValue('');
  });

  test('change password and change it back', async ({ page }) => {
    const k = ui(page);
    const OLD = process.env.MOCHI_PASSWORD!;
    const NEW = `${OLD}-e2e`;
    await page.goto('/profile');
    const current = page.locator('input[autocomplete="current-password"]');

    const change = async (from: string, to: string, expectClear: boolean) => {
      await k.on(page).textIn('Current password').fill(from);
      await k.on(page).textIn('New password').fill(to);
      await k.on(page).textIn('Confirm password').fill(to);
      const post = k.posted('/profile');
      await page.getByRole('button', { name: 'Change password' }).click();
      await post;
      // The input-clearing effect fires only on the ok TRANSITION, which the
      // fetcher produces once — assert it on change #1 alone. The revert is
      // proven by its 200 (a wrong current password returns 400, which
      // posted() refuses to match).
      if (expectClear) await expect(current).toHaveValue('');
    };

    try {
      await change(OLD, NEW, true);
      await expect(page.getByText('Password changed ✓')).toBeVisible();
    } finally {
      await change(NEW, OLD, false); // restore for every later spec
    }
  });
});
