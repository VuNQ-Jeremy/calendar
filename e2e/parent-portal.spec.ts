import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { crudGuard, openConfigEntry, signInStaff, ui } from './crud-helpers';

/**
 * The parent portal, end to end: a real parent account, the admin toggle, and the gate between.
 *
 * The property under test is that the toggle is a REAL gate rather than a way to hide a nav link.
 * With the portal closed a parent must not be able to reach /children by typing the URL, and must
 * not be able to open their child's report document either — both are checked directly, not just
 * by the absence of a link.
 *
 * A student is created with a parent inline, which mints both codes (see crud-invite-redeem.spec),
 * and the parent code is redeemed in its own context to get a genuine parent session. Rows are
 * cleaned up at the end; test-accounts.sql sweeps the leftover accounts on reset.
 */

/** Flip Config → Parent access, and wait for the write to land. */
async function setPortal(page: Page, on: boolean) {
  const k = ui(page);
  await page.goto('/config');
  const dlg = await openConfigEntry(page, 'Parent access');
  // Click the CHIP, read the input. The DS checkbox hides its native input behind a styled span,
  // so clicking the input itself never settles ("element is not stable") — only `toBeChecked` and
  // `isChecked` tolerate the hidden input. There is exactly one check in this dialog
  // ("Let parents see their children"), so the bare `.mochi-check` is unambiguous.
  const check = dlg.locator('.mochi-check');
  const box = check.locator('input[type="checkbox"]');
  if ((await box.isChecked()) !== on) {
    const post = k.posted('/config');
    await check.click();
    await post;
  }
  await expect(box).toBeChecked({ checked: on });
  await page.keyboard.press('Escape');
}

test.describe('Parent portal', () => {
  crudGuard();

  test('the admin toggle gates the children screens, not the login', async ({ page, browser }) => {
    const k = ui(page);
    const stamp = Date.now();
    const studentName = `E2E portal student ${stamp}`;
    const parentName = `E2E portal parent ${stamp}`;
    const parentEmail = `e2e-portal-p-${stamp}@example.com`;

    // ---- Staff: create the family, collect the parent's code.
    await signInStaff(page);
    await setPortal(page, false);

    await page.goto('/people');
    await page.getByRole('button', { name: 'Add student' }).click();
    await k.textIn('Full name').fill(studentName);
    await k.dlg.getByPlaceholder('Parent name').fill(parentName);
    let post = k.posted('/people');
    await k.submit().click();
    await post;

    const codesDlg = k.dlgOf('Invite codes ready');
    // Gate on the codes being ON SCREEN first: `allInnerTexts()` does not auto-wait, and awaiting
    // the POST only proves the server minted them — the save dialog is still up for the re-render
    // that swaps it for this one, so the unguarded read returned [].
    const code = codesDlg.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    await expect(code.first()).toBeVisible();
    const codes = (await code.allInnerTexts()).map((c) => c.trim());
    expect(codes).toHaveLength(2);
    const parentCode = codes[1]; // minted student-first, then parent
    await codesDlg.getByRole('button', { name: 'Done' }).click();

    // ---- The parent signs in while the portal is CLOSED.
    const ctx = await browser.newContext();
    const parent = await ctx.newPage();
    await parent.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await parent.goto('/login');
    await parent.getByRole('button', { name: 'I have an invite code' }).click();
    await parent.locator('input.auth-code').fill(parentCode);
    await parent.getByRole('button', { name: 'Continue' }).click();
    await parent.fill('input[name="email"]', parentEmail);
    await parent.fill('input[name="password"]', 'e2e-pass-123');
    await parent.click('form[action="/login"] button[type="submit"]');

    // Login works regardless of the toggle — that is the whole point of gating only the portal.
    await parent.waitForURL(/\/profile/, { timeout: 30_000 });
    // No nav row, and the URL is refused rather than merely unlinked.
    await expect(parent.getByRole('link', { name: 'My children' })).toHaveCount(0);
    await parent.goto('/children');
    await expect(parent).toHaveURL(/\/profile/);

    // ---- Admin opens the portal.
    await setPortal(page, true);

    // The parent's own session picks it up on the next navigation; no re-login.
    await parent.goto('/children');
    await expect(parent).toHaveURL(/\/children/);
    await expect(parent.getByRole('heading', { name: 'My children' })).toBeVisible();
    // Their child is listed, and only their child.
    await expect(parent.getByText(studentName)).toBeVisible();

    // The nav row exists now.
    await expect(parent.getByRole('link', { name: 'My children' })).toBeVisible();

    // Into the child's month: attendance, and the two documents. The real student id comes from
    // this link — the 403 assertions below must aim at a genuine child, or they would pass
    // vacuously against an id that does not exist.
    const openLink = parent.getByRole('link', { name: 'Open' }).first();
    const childHref = await openLink.getAttribute('href');
    const studentId = childHref!.split('/').pop()!;
    await openLink.click();
    await expect(parent).toHaveURL(/\/children\/[^/]+$/);
    await expect(parent.getByText('Attendance')).toBeVisible();
    await expect(parent.getByRole('button', { name: 'Report card' })).toBeVisible();
    await expect(parent.getByRole('button', { name: 'Fee slip' })).toBeVisible();

    // The documents themselves, not just the buttons: their own child's report and fee slip open.
    const month = '2026-05';
    expect((await parent.request.get(`/assessments/${month}/${studentId}/report`)).status()).toBe(
      200,
    );
    expect((await parent.request.get(`/tuition/${month}/${studentId}/print`)).status()).toBe(200);

    // Another family's child stays refused even with the portal open — the ownership half of the
    // rule is independent of the toggle.
    const strangerId = '00000000-0000-0000-0000-000000000000';
    expect((await parent.request.get(`/assessments/${month}/${strangerId}/report`)).status()).toBe(
      403,
    );

    // ---- Closing it puts them back in the profile-only app, documents included: the exact URL
    // that returned 200 a moment ago must now 403.
    await setPortal(page, false);
    await parent.goto('/children');
    await expect(parent).toHaveURL(/\/profile/);
    expect((await parent.request.get(`/assessments/${month}/${studentId}/report`)).status()).toBe(
      403,
    );
    expect((await parent.request.get(`/tuition/${month}/${studentId}/print`)).status()).toBe(403);
    await ctx.close();

    // ---- Cleanup.
    await page.goto('/people');
    const studentRow = page.locator('.lrow', { hasText: studentName });
    await studentRow.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/people');
    await k.dlgOf('Remove student?').locator('.mochi-btn.is-danger').click();
    await post;

    await page.getByRole('tab', { name: /^Parents · / }).click();
    const parentRow = page.locator('.lrow', { hasText: parentName });
    await parentRow.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/people');
    await k.dlgOf('Remove parent?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(parentRow).toHaveCount(0);
  });
});
