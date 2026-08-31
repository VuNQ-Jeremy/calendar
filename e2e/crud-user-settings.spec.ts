import { test, expect, type Page } from '@playwright/test';
import { crudGuard, gotoEmailLogin, signInStaff, ui } from './crud-helpers';

/**
 * Feedback F-19 / issue #17: calendar customization must be per-user, not global.
 *
 * Two real accounts in two browser contexts. The second is minted the way a colleague actually
 * joins — staff adds a teacher, which mints an invite code, and the code is redeemed in a fresh
 * anonymous context. Its email uses the `e2e-redeem-` prefix that scripts/test-accounts.sql
 * sweeps, so the account cleans itself up; the teacher row is deleted here.
 *
 * The theme reaches the DOM as CSS custom properties on `.calwrap` (src/calendar/index.tsx), so
 * `--cal-bg` is what the assertions read.
 */

const calBg = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.calwrap') as HTMLElement | null;
    return el ? getComputedStyle(el).getPropertyValue('--cal-bg').trim() : null;
  });

/** The theme drawer is a `.drawer`, not one of the `.m-dialog` modals the helper kit locates. */
const themeDrawer = (page: Page) => page.locator('.drawer[role="dialog"]');

/** The seeded school-wide theme (seed.sql), which is what an account with no theme of its own sees. */
const SCHOOL_DEFAULT_BG = '#FFFCF8'; // preset "Cream"
const DUSK_BG = '#2E2A33';

/**
 * Apply a preset BY NAME and wait for the write to land.
 *
 * Named rather than "whichever one isn't active": picking relatively means the colour an account
 * ends up with depends on the colour it started with, so a retry — where account A is still
 * wearing the colour the failed attempt gave it — can land it back on the school default and make
 * the isolation assertions compare two identical colours.
 */
async function pickPreset(page: Page, name: string) {
  await page.getByRole('button', { name: 'Customize' }).click();
  const drawer = themeDrawer(page);
  await expect(drawer).toBeVisible();
  const posted = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && new URL(r.url()).pathname === '/calendar.data' && r.ok(),
  );
  await drawer.locator('.preset', { hasText: name }).click();
  await posted;
  await drawer.getByRole('button', { name: 'Done' }).click();
  await expect(drawer).toHaveCount(0);
}

test.describe('CRUD: per-account calendar theme', () => {
  crudGuard();

  test('one account recolouring the calendar does not recolour another', async ({
    page,
    browser,
  }) => {
    const k = ui(page);
    const stamp = Date.now();
    const teacherName = `E2E theme teacher ${stamp}`;

    await signInStaff(page);

    // --- Account A picks a distinctive colour through the Customize drawer.
    await page.goto('/calendar');
    await expect(page.locator('.calwrap')).toBeVisible();
    await pickPreset(page, 'Dusk');
    await expect.poll(() => calBg(page)).toBe(DUSK_BG);
    const aColor = DUSK_BG;

    // --- Mint account B: add a teacher, take the invite code it produces.
    await page.goto('/people');
    await page.getByRole('tab', { name: /^Teachers · / }).click();
    await page.getByRole('button', { name: 'Add teacher' }).click();
    await k.textIn('Full name').fill(teacherName);
    await k.pickSel('Role', 'Assistant');
    const savedTeacher = k.posted('/people');
    await k.submit().click(); // "Save"
    await savedTeacher;

    const codesDlg = k.dlgOf('Invite codes ready');
    const code = codesDlg.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    await expect(code.first()).toBeVisible();
    const inviteCode = (await code.first().innerText()).trim();
    await codesDlg.getByRole('button', { name: 'Done' }).click();

    // --- Account B redeems it in a fresh context and opens the calendar.
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await other.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await gotoEmailLogin(other);
    await other.getByRole('button', { name: 'I have an invite code' }).click();
    await other.locator('input.auth-code').fill(inviteCode);
    await other.getByRole('button', { name: 'Continue' }).click();
    await expect(other.locator('h2.auth-title')).toHaveText(/invited/);
    await other.fill('input[name="email"]', `e2e-redeem-theme-${stamp}@example.com`);
    await other.fill('input[name="password"]', 'e2e-pass-123');
    await other.click('form[action="/login"] button[type="submit"]'); // "Join Mochi"
    await other.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await other.goto('/calendar');
    await expect(other.locator('.calwrap')).toBeVisible();
    // THE assertion this spec exists for: a brand new account sees the school default, not the
    // colour A chose a moment ago.
    expect(await calBg(other)).toBe(SCHOOL_DEFAULT_BG);

    // --- B picks its own, and A is untouched by it.
    await pickPreset(other, 'Meadow');
    await expect.poll(() => calBg(other)).not.toBe(SCHOOL_DEFAULT_BG);

    // `page` was left on /people by the invite step above, so this has to navigate, not reload.
    await page.goto('/calendar');
    await expect(page.locator('.calwrap')).toBeVisible();
    expect(await calBg(page)).toBe(aColor);

    await ctx.close();

    // --- Clean up the teacher row. The account goes with the `e2e-redeem-%` sweep.
    await page.goto('/people');
    await page.getByRole('tab', { name: /^Teachers · / }).click();
    const row = page.locator('.lrow', { hasText: teacherName });
    await row.getByRole('button', { name: 'Delete' }).click();
    const deleted = k.posted('/people');
    await k.dlgOf('Remove teacher?').locator('.mochi-btn.is-danger').click();
    await deleted;
    await expect(row).toHaveCount(0);
  });

  /**
   * Feedback F-22 / issue #20: the default day/week/month view is a customization option.
   * It rides on the same per-account theme blob, so per-account isolation is already proven
   * above — this test covers the new write path and that the choice survives a reload.
   */
  test('default view chosen in Customize is how the calendar opens', async ({ page }) => {
    await signInStaff(page);
    await page.goto('/calendar');
    await expect(page.locator('.calwrap')).toBeVisible();

    // Fresh account state opens in week view: the time grid, not the month grid.
    const toolbar = page.locator('.cal-toolbar');
    await expect(toolbar.getByRole('tab', { name: 'Week' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Pick Month as the default, through the drawer. Both the drawer and the toolbar have
    // tabs named Month, so every tab click here is scoped to its container.
    await page.getByRole('button', { name: 'Customize' }).click();
    const drawer = themeDrawer(page);
    await expect(drawer).toBeVisible();
    const posted = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname === '/calendar.data' && r.ok(),
    );
    await drawer.getByRole('tab', { name: 'Month' }).click();
    await posted;
    await drawer.getByRole('button', { name: 'Done' }).click();
    await expect(drawer).toHaveCount(0);

    // The calendar now OPENS in month view.
    await page.reload();
    await expect(page.locator('.calwrap')).toBeVisible();
    await expect(page.locator('.calwrap .month')).toBeVisible();
    await expect(toolbar.getByRole('tab', { name: 'Month' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // --- Put the seeded account back on week so reruns and other specs see a fresh state.
    await page.getByRole('button', { name: 'Customize' }).click();
    const drawer2 = themeDrawer(page);
    const reverted = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname === '/calendar.data' && r.ok(),
    );
    await drawer2.getByRole('tab', { name: 'Week' }).click();
    await reverted;
    await drawer2.getByRole('button', { name: 'Done' }).click();
    await expect(drawer2).toHaveCount(0);
  });
});
