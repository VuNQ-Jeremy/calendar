import { test, expect } from '@playwright/test';
import { crudGuard, pickDay, signInStaff, signInStudent, ui } from './crud-helpers';

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

    // ---- A student may not open it at all, nav row or no nav row. ----
    // requireAdmin (server/services/auth.ts) is requireStaff + an Admin check, and requireStaff
    // REDIRECTS a student to /vocabulary before the 403 branch is ever reached — only non-Admin
    // staff see a bare 403. request.get follows redirects, so asserting 403 here read the landing
    // page's 200. Pin maxRedirects: 0 and assert the redirect itself, which is the real denial.
    const studentCtx = await browser.newContext();
    const sp = await studentCtx.newPage();
    await signInStudent(sp);
    const denied = await sp.request.get('/logs/notifications', { maxRedirects: 0 });
    expect(denied.status()).toBe(302);
    expect(denied.headers()['location']).toBe('/vocabulary');
    await expect(sp.locator('.sb a[href="/logs"]')).toHaveCount(0);
    await studentCtx.close();

    // ---- Admin: the tab is a navigation, not local state. ----
    await signInStaff(page);
    await page.goto('/logs');
    await page.getByRole('tab', { name: 'Notifications' }).click();
    await page.waitForURL(/\/logs\/notifications$/);

    // The status strip plus one card per job, and the ledger panel.
    await expect(page.locator('.mochi-card', { hasText: 'Delivery status' })).toBeVisible();
    /**
     * A job's OWN card, by its `<strong>` title.
     *
     * Plain `hasText` is not enough: the Delivery status strip lists every job name as a chip, so
     * `.mochi-card` filtered on the name matches that strip too — and `.first()` picks it, since
     * it renders above the job cards. Only a JobCard puts the name in a `<strong>`.
     */
    const jobCard = (name: string) =>
      page.locator('.mochi-card').filter({ has: page.locator('strong', { hasText: name }) });

    for (const job of [
      'Class reminders',
      'Evening previews',
      'Study nudges',
      'Garden alerts',
      'Recently sent',
    ]) {
      await expect(jobCard(job)).toBeVisible();
    }

    // ---- A class session tomorrow must appear in the evening-preview forecast. ----
    // Two days out, so the 19:00 slot that would send it has not passed whatever time this runs.
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await k.textIn('Title').fill(title);
    // Date is a picker, not a text input — see pickDay in crud-helpers.
    await pickDay(page, 'Date', day);
    // Start is an MTimePicker, so it is picked like a select (same as 'Due time' in crud-garden),
    // not filled as text.
    await k.pickSel('Start', '9:00 am');
    // A class is required: previews only cover occurrences that belong to one.
    await k.pickSel('Class', 'Biology 9A');
    let post = k.posted('/calendar');
    await k.submit().click();
    await post;

    await page.goto('/logs/notifications');
    const previews = jobCard('Evening previews');
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
    // The button is also rendered DISABLED (title="already sent") once its key is in
    // sent_notifications — which "Run now" above has just put there for every row in this
    // forecast. So the guard has to test enabled-ness, not mere presence: clicking a disabled
    // button never resolves, it just waits out the test timeout.
    const rowSend = previews.getByRole('button', { name: 'Send', exact: true }).first();
    if ((await rowSend.count()) && (await rowSend.isEnabled())) {
      await rowSend.click();
      post = k.posted('/logs/notifications');
      await page.locator('.m-dialog__foot .mochi-btn.is-primary').first().click();
      await post;
    } else {
      await expect(previews).toContainText('no recipients');
    }

    // ---- Cleanup: delete the event; the forecast row goes with it. ----
    // The event dialog deletes in ONE click: its footer's danger button calls onDelete directly
    // (src/calendar/event-modal.tsx) — there is no confirm step. The old flow clicked that button
    // and then waited for a confirm dialog that never opens, and registered its POST listener
    // after the click that fires it. Same shape as the other specs' teardown.
    await page.goto('/calendar');
    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).first().click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;

    await page.goto('/logs/notifications');
    await expect(
      page.locator('.mochi-card', { hasText: 'Evening previews' }).first(),
    ).not.toContainText(title);
  });
});
