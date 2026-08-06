import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Feedback board CRUD and the profile update. Password change is deliberately
 * NOT tested — it would revoke the shared e2e account's other sessions.
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
});
