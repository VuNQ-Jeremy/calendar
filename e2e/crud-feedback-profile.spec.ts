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

  test('feedback: create, triage to backlog, resolve, edit, delete', async ({ page }) => {
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

    // All five triage columns render, in travel order.
    for (const title of ['New', 'Reviewed', 'On hold', 'Backlog', 'Resolved']) {
      await expect(column(title)).toBeVisible();
    }

    // The card carries exactly two action buttons — copy and delete. Status moves by drag or
    // through the editor's Status select; there is no resolve button any more.
    await expect(card(msg).getByRole('button', { name: 'Copy feedback id' })).toBeVisible();
    await expect(card(msg).getByRole('button', { name: 'Mark resolved' })).toHaveCount(0);
    expect(await card(msg).locator('.lrow__actions button').count()).toBe(2);

    // The whole card opens the editor — there is no edit button. Aim at the message rather
    // than the card's centre: the centre can land on the meta row, where the issue link would
    // swallow the click (and open a tab) on a report that has one. Pause it mid-work…
    await card(msg).locator('.kcard__msg').click();
    await k.pickSel('Status', 'On hold');
    post = k.posted('/feedback');
    await k.submit().click(); // "Save"
    await post;
    await expect(column('On hold').locator('.kcard', { hasText: msg })).toBeVisible();

    // …then park it in the backlog.
    await card(msg).locator('.kcard__msg').click();
    await k.pickSel('Status', 'Backlog');
    post = k.posted('/feedback');
    await k.submit().click(); // "Save"
    await post;
    await expect(column('Backlog').locator('.kcard', { hasText: msg })).toBeVisible();

    // Pull it back out of the backlog to Resolved, editing the message in the same save.
    await card(msg).locator('.kcard__msg').click();
    await k.textIn('Your feedback').fill(`${msg} v2`);
    await k.pickSel('Status', 'Resolved');
    post = k.posted('/feedback');
    await k.submit().click(); // "Save"
    await post;
    await expect(column('Resolved').locator('.kcard', { hasText: `${msg} v2` })).toBeVisible();

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

  test('changelog: hide an entry and restore it', async ({ page }) => {
    const k = ui(page);
    await page.goto('/feedback');
    await page.getByRole('button', { name: 'Changelog' }).click();
    const dlg = k.dlgOf('Changelog');
    const rows = dlg.locator('.lrow');
    await expect(rows.first()).toBeVisible();

    // The version chip is the row's identity — the body prose changes with every release, and
    // the newest entry is whatever the build under test shipped with.
    const version = (await rows.first().locator('.lrow__meta .m-row').first().innerText()).trim();
    expect(version).toMatch(/^v\d+\.\d+$/);
    const chip = (v: string) => dlg.getByText(v, { exact: true });

    let post = k.posted('/feedback');
    await rows.first().getByRole('button', { name: 'Hide this entry' }).click();
    await post;
    // Gone from the list, not merely greyed. Row COUNT is not the assertion: the page keeps
    // showing ten entries, so hiding one just pulls the eleventh into view.
    await expect(chip(version)).toHaveCount(0);

    // It survives a reload, which is the whole point of storing it server-side.
    await page.reload();
    await page.getByRole('button', { name: 'Changelog' }).click();
    await expect(chip(version)).toHaveCount(0);

    // Restore through the hidden toggle, so the next run starts from a full changelog. The
    // staging reset also clears the row (scripts/test-accounts.sql) if this spec dies here.
    await dlg.getByRole('button', { name: /^Show hidden \(\d+\)$/ }).click();
    const hiddenRow = rows.filter({ has: chip(version) });
    post = k.posted('/feedback');
    await hiddenRow.getByRole('button', { name: 'Show this entry again' }).click();
    await post;
    await expect(chip(version)).toBeVisible();
    // With nothing hidden the toggle has nothing to offer and leaves.
    await expect(dlg.getByRole('button', { name: /^Show hidden/ })).toHaveCount(0);
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
