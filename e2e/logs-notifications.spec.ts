import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent, ui } from './crud-helpers';

/**
 * /logs → Notifications: the cron forecast, the sent ledger, and the run-now triggers.
 *
 * What is worth asserting here is what could break silently. The admin guard, because the nav row
 * being hidden is not a permission. The tab navigation, because these two tabs are separate routes
 * rather than local state and `/logs/notifications` would be swallowed by `/logs/:studentId?` if the
 * static route were ever dropped. And that a real event shows up in the forecast, because a forecast
 * that quietly lists nothing looks exactly like a forecast with nothing to list.
 *
 * The run-now button is pressed for `preview` only. It is idempotent through the ledger, and the
 * test environment has no registered devices, so it sends nothing — but it does exercise the
 * cookie-authed action, which is the one piece of new server code a browser reaches. The garden
 * button is deliberately NOT pressed: that job charges deadlines and writes an album.
 *
 * Notification prefs are never touched — they live in the `settings` table, which
 * scripts/test-accounts.sql does not sweep, so a changed flag would leak into every later run.
 */

test.describe('logs: scheduled notifications', () => {
  crudGuard();

  test('notifications tab: admin-only, forecasts a real event, runs a job', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const k = ui(page);
    const title = `E2E notif ${Date.now()}`;

    // ---- A student may not open it at all: requireAdmin 403s, nav row or no nav row. ----
    const studentCtx = await browser.newContext();
    const sp = await studentCtx.newPage();
    await signInStudent(sp);
    expect((await sp.request.get('/logs/notifications')).status()).toBe(403);
    await expect(sp.locator('.sb a[href="/logs"]')).toHaveCount(0);
    await studentCtx.close();

    // ---- Admin: the tab is a navigation, not local state. ----
    await signInStaff(page);
    await page.goto('/logs');
    await page.getByRole('tab', { name: 'Notifications' }).click();
    await page.waitForURL(/\/logs\/notifications$/);

    // The status strip plus one card per job, and the ledger panel.
    await expect(page.locator('.mochi-card', { hasText: 'Delivery status' })).toBeVisible();
    for (const job of [
      'Class reminders',
      'Evening previews',
      'Study nudges',
      'Garden alerts',
      'Recently sent',
    ]) {
      await expect(page.locator('.mochi-card', { hasText: job }).first()).toBeVisible();
    }

    // ---- A class session tomorrow must appear in the evening-preview forecast. ----
    // Two days out, so the 19:00 slot that would send it has not passed whatever time this runs.
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await k.textIn('Title').fill(title);
    await k.textIn('Date').fill(day);
    await k.textIn('Start').fill('09:00');
    // A class is required: previews only cover occurrences that belong to one.
    await k.pickSel('Class', 'Biology 9A');
    let post = k.posted('/calendar');
    await k.submit().click();
    await post;

    await page.goto('/logs/notifications');
    const previews = page.locator('.mochi-card', { hasText: 'Evening previews' }).first();
    await expect(previews).toContainText('Biology 9A');

    // ---- Run the preview job. Idempotent, and nothing is registered to receive it here. ----
    post = k.posted('/logs/notifications');
    await previews.getByRole('button', { name: 'Run now' }).click();
    await post;
    await expect(previews).toContainText('push messages');

    // ---- A single row can be sent on its own, without running the whole job. ----
    //
    // Only rows with a real recipient offer the button, so this asserts what is there rather than
    // demanding a send: in a freshly seeded environment no device is registered and every row reads
    // "no recipients", which is itself the behaviour worth seeing.
    const rowSend = previews.getByRole('button', { name: 'Send', exact: true }).first();
    if (await rowSend.count()) {
      await rowSend.click();
      post = k.posted('/logs/notifications');
      await page.locator('.m-dialog__foot .mochi-btn.is-primary').first().click();
      await post;
    } else {
      await expect(previews).toContainText('no recipients');
    }

    // ---- Cleanup: delete the event; the forecast row goes with it. ----
    await page.goto('/calendar');
    await page.getByText(title, { exact: false }).first().click();
    await page.getByRole('button', { name: 'Delete' }).first().click();
    post = k.posted('/calendar');
    await page.locator('.m-dialog .mochi-btn.is-danger').first().click();
    await post;

    await page.goto('/logs/notifications');
    await expect(
      page.locator('.mochi-card', { hasText: 'Evening previews' }).first(),
    ).not.toContainText(title);
  });
});
