import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Full invite lifecycle across three browser contexts: staff adds a student with a parent,
 * which mints one code each, and two anonymous visitors redeem them on /login.
 *
 * The assertion that matters is the roster count. Codes are LINKED to the person staff
 * created, so redeeming must attach an account to that row — it must not add a second
 * "E2E linked ..." student the way the old unlinked codes did.
 *
 * The student and parent rows are cleaned up here; test-accounts.sql sweeps the leftover
 * accounts on every reset.
 */

test.describe('CRUD: invite redemption', () => {
  crudGuard();

  test('add a student with a parent, redeem both codes, no duplicate rows', async ({
    page,
    browser,
  }) => {
    const k = ui(page);
    const stamp = Date.now();
    const studentName = `E2E linked student ${stamp}`;
    const parentName = `E2E linked parent ${stamp}`;

    // Staff: add the student, entering the parent inline. Two codes come back.
    await signInStaff(page);
    await page.goto('/people');
    await page.getByRole('button', { name: 'Add student' }).click();
    await k.textIn('Full name').fill(studentName);
    await k.dlg.getByPlaceholder('Parent name').fill(parentName);
    const post = k.posted('/people');
    await k.submit().click(); // "Save"
    await post;

    const codesDlg = k.dlgOf('Invite codes ready');
    // Rendered in the order the action minted them: student first, then parent.
    const codes = (await codesDlg.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/).allInnerTexts()).map((c) =>
      c.trim(),
    );
    expect(codes).toHaveLength(2);
    const [studentCode, parentCode] = codes;
    await expect(codesDlg.getByText('Student code')).toBeVisible();
    await expect(codesDlg.getByText('Parent code')).toBeVisible();
    await codesDlg.getByRole('button', { name: 'Done' }).click();

    /** Redeem `code` in a fresh anonymous context and return the URL it lands on. */
    const redeem = async (code: string, email: string) => {
      const ctx = await browser.newContext();
      const visitor = await ctx.newPage();
      await visitor.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
      await visitor.goto('/login');
      await visitor.getByRole('button', { name: 'I have an invite code' }).click();
      await visitor.locator('input.auth-code').fill(code);
      await visitor.getByRole('button', { name: 'Continue' }).click();
      await expect(visitor.locator('h2.auth-title')).toHaveText(/invited/);
      // A linked code already knows the name — the field arrives filled and read-only.
      await expect(visitor.locator('input[name="name"]')).toHaveJSProperty('readOnly', true);
      await visitor.fill('input[name="email"]', email);
      await visitor.fill('input[name="password"]', 'e2e-pass-123');
      await visitor.click('form[action="/login"] button[type="submit"]'); // "Join Mochi"
      await visitor.waitForURL(/\/(dashboard|vocabulary|profile)/, { timeout: 30_000 });
      const landed = new URL(visitor.url()).pathname;
      await ctx.close();
      return landed;
    };

    // The student is a learner: they land on the vocabulary screen.
    expect(await redeem(studentCode, `e2e-redeem-s-${stamp}@example.com`)).toBe('/vocabulary');
    // The parent's whole app is the profile screen.
    expect(await redeem(parentCode, `e2e-redeem-p-${stamp}@example.com`)).toBe('/profile');

    // Exactly one student row with that name — the redeem attached, it did not duplicate.
    await page.goto('/people');
    const studentRow = page.locator('.lrow', { hasText: studentName });
    await expect(studentRow).toHaveCount(1);
    // And the row shows the linked parent where the free-text guardian used to be.
    await expect(studentRow).toContainText(parentName);

    await studentRow.getByRole('button', { name: 'Delete' }).click();
    let del = k.posted('/people');
    await k.dlgOf('Remove student?').locator('.mochi-btn.is-danger').click();
    await del;
    await expect(studentRow).toHaveCount(0);

    await page.getByRole('tab', { name: /^Parents · / }).click();
    const parentRow = page.locator('.lrow', { hasText: parentName });
    await expect(parentRow).toHaveCount(1);
    await parentRow.getByRole('button', { name: 'Delete' }).click();
    del = k.posted('/people');
    await k.dlgOf('Remove parent?').locator('.mochi-btn.is-danger').click();
    await del;
    await expect(parentRow).toHaveCount(0);
  });
});
