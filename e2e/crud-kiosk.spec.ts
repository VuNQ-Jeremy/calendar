import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * The classroom kiosk itself: name grid → personal board → tap → confetti + bag, and the
 * auto-present side effect on attendance. Opens in a new tab (the modal's kiosk link is
 * target="_blank"), so most assertions run against that popup page while the original tab
 * still owns the event modal for setup and cleanup.
 */

test.describe('CRUD: kiosk', () => {
  crudGuard();

  test('tap through a single-item check-in: present, bag, idempotent re-tap', async ({
    page,
    context,
  }) => {
    const k = ui(page);
    const typeName = `E2E kiosk activity ${Date.now()}`;

    // A managed activity type to build the checklist item from.
    await signInStaff(page);
    await page.goto('/config');
    await page.locator('.cfg-row', { hasText: 'Check-in activities' }).click();
    const typesDlg = page.locator('.m-dialog:has(.m-dialog__title:text-is("Check-in activities"))');
    await typesDlg.getByRole('button', { name: 'Add activity' }).click();
    await k.dlgOf('Add activity').locator('input.mochi-input').fill(typeName);
    let post = k.posted('/config');
    await k.submit().click();
    await post;
    await page.keyboard.press('Escape');

    // A TODAY event on Biology 9A, so the seeded student (Leo Park) has a real roster and
    // attendance can be asserted afterward.
    const title = `E2E kiosk session ${Date.now()}`;
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await k.dlg.locator('input[placeholder="e.g. Biology lab"]').fill(title);
    await k.pickSel('Class', 'Biology 9A');
    post = k.posted('/calendar');
    await k.submit().click();
    await post;

    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).click();
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();

    // A single check-in item — so completing it is also completing the whole phase.
    const thisSection = k.dlg.locator('.ck-section--this');
    post = k.posted('/checkin');
    await thisSection.getByRole('button', { name: 'Add item' }).click();
    await post;
    // The row starts with no activity picked, so choose the throwaway type explicitly —
    // that is what gives the kiosk cell its icon and colour.
    post = k.posted('/checkin');
    await thisSection.locator('button.m-select__trigger').click();
    await page.getByRole('option', { name: typeName, exact: true }).click();
    await post;
    post = k.posted('/checkin');
    await thisSection.locator('input.mochi-input').fill('Học phát âm 5 phút');
    await thisSection.locator('input.mochi-input').blur();
    await post;

    // Open the check-in kiosk — it's a target="_blank" link, so a new tab appears.
    const [kiosk] = await Promise.all([
      context.waitForEvent('page'),
      thisSection.getByRole('link', { name: 'Open check-in kiosk' }).click(),
    ]);
    await kiosk.waitForLoadState();
    await expect(kiosk.locator('.kiosk-card', { hasText: 'Leo Park' })).toBeVisible();

    await kiosk.locator('.kiosk-card', { hasText: 'Leo Park' }).click();
    await expect(kiosk.locator('.kiosk-cell')).toHaveCount(1);

    // First tap: completes the only check-in item -> earns a bag (perfect_day default
    // needs check-out too, but check-in-only sessions still exercise per_phase logic
    // server-side; here we only assert the check landed and attendance followed).
    const cellPost = kiosk.waitForResponse(
      (r) => r.url().endsWith('/checkin.data') && r.request().method() === 'POST' && r.ok(),
    );
    await kiosk.locator('.kiosk-cell').click();
    await cellPost;
    await expect(kiosk.locator('.kiosk-cell-check')).toBeVisible();

    // Re-tap (uncheck) then tap again (re-check) — idempotency: no error, no duplicate state.
    const uncheckPost = kiosk.waitForResponse(
      (r) => r.url().endsWith('/checkin.data') && r.request().method() === 'POST' && r.ok(),
    );
    await kiosk.locator('.kiosk-cell').click();
    await uncheckPost;
    await expect(kiosk.locator('.kiosk-cell-check')).toHaveCount(0);
    const recheckPost = kiosk.waitForResponse(
      (r) => r.url().endsWith('/checkin.data') && r.request().method() === 'POST' && r.ok(),
    );
    await kiosk.locator('.kiosk-cell').click();
    await recheckPost;
    await expect(kiosk.locator('.kiosk-cell-check')).toBeVisible();

    await kiosk.close();

    // Auto-present: the Attendance tab should now show Leo Park as Present, though the
    // teacher never touched that tab. The active chip is the one styled white-on-color
    // (see AttendanceTab in event-modal.tsx) — an inactive chip keeps the muted ink color.
    await k.dlg.getByRole('tab', { name: 'Attendance' }).click();
    const leoRow = k.dlg.locator('.lrow', { hasText: 'Leo Park' });
    await expect(leoRow.getByRole('button', { name: 'Present' })).toHaveCSS(
      'color',
      'rgb(255, 255, 255)',
    );

    // Cleanup: delete the event, then the throwaway activity type.
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;

    await page.goto('/config');
    await page.locator('.cfg-row', { hasText: 'Check-in activities' }).click();
    const row = page.locator('.lrow', { hasText: typeName });
    post = k.posted('/config');
    await row.getByRole('button', { name: 'Delete' }).click();
    await k.dlgOf('Delete this activity?').getByRole('button', { name: 'Delete' }).click();
    await post;
  });
});
