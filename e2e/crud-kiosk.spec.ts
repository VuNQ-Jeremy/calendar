import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * The classroom kiosk itself: name grid → personal board → tap → confetti + bag, and the
 * auto-present side effect on attendance. It is a fullscreen layer over the app rather than a
 * route, so it opens and closes in the same tab and the event dialog is still mounted behind
 * it for the attendance assertion and the cleanup.
 */

test.describe('CRUD: kiosk', () => {
  crudGuard();

  test('tap through a single-item check-in: present, bag, idempotent re-tap', async ({ page }) => {
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

    // Open the kiosk — same tab, layered over the dialog.
    const kiosk = page.locator('.kiosk-overlay');
    await thisSection.getByRole('button', { name: 'Open check-in kiosk' }).click();
    await expect(kiosk.locator('.kiosk-card', { hasText: 'Leo Park' })).toBeVisible();

    await kiosk.locator('.kiosk-card', { hasText: 'Leo Park' }).click();
    await expect(kiosk.locator('.kiosk-cell')).toHaveCount(1);
    // The cell names the activity type AND the teacher's detail, not one or the other.
    await expect(kiosk.locator('.kiosk-cell-type')).toHaveText(typeName);
    await expect(kiosk.locator('.kiosk-cell-label')).toHaveText('Học phát âm 5 phút');

    // First tap: completes the only check-in item -> earns a bag (perfect_day default
    // needs check-out too, but check-in-only sessions still exercise per_phase logic
    // server-side; here we only assert the check landed and attendance followed).
    let cellPost = k.posted('/checkin');
    await kiosk.locator('.kiosk-cell').click();
    await cellPost;
    await expect(kiosk.locator('.kiosk-cell-check')).toBeVisible();

    // Re-tap (uncheck) then tap again (re-check) — idempotency: no error, no duplicate state.
    cellPost = k.posted('/checkin');
    await kiosk.locator('.kiosk-cell').click();
    await cellPost;
    await expect(kiosk.locator('.kiosk-cell-check')).toHaveCount(0);
    cellPost = k.posted('/checkin');
    await kiosk.locator('.kiosk-cell').click();
    await cellPost;
    await expect(kiosk.locator('.kiosk-cell-check')).toBeVisible();

    await kiosk.getByRole('button', { name: 'Close kiosk' }).click();
    await expect(kiosk).toHaveCount(0);

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
    await k.confirmDanger('Delete this activity?').click();
    await post;
  });

  test("dashboard's today rows open the event dialog, and the kiosk from there", async ({
    page,
  }) => {
    const k = ui(page);
    const title = `E2E dash row ${Date.now()}`;

    await signInStaff(page);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await k.dlg.locator('input[placeholder="e.g. Biology lab"]').fill(title);
    await k.pickSel('Class', 'Biology 9A');
    let post = k.posted('/calendar');
    await k.submit().click();
    await post;

    // The row itself opens the same dialog the calendar uses — check-in tab and all.
    await page.goto('/dashboard');
    const dashRow = page.locator('.lrow', { hasText: title });
    await dashRow.click();
    await expect(k.dlg.locator('input[placeholder="e.g. Biology lab"]')).toHaveValue(title);
    await expect(k.dlg.getByRole('tab', { name: 'Check-in/out' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Its kiosk button opens the kiosk instead of the dialog (the click must not fall through).
    await dashRow.getByRole('button', { name: 'Open check-in kiosk' }).click();
    const kiosk = page.locator('.kiosk-overlay');
    // The header, not a name card: this event has no authored checklist, and kiosk.tsx shows its
    // empty state instead of the name grid when `items.length === 0` (a kiosk with nothing to tick
    // has no roster to offer). Naming the event's class still proves the right kiosk opened — and
    // pairing it with the dialog count is what proves the click did not fall through.
    await expect(kiosk.locator('.kiosk-title')).toContainText('Biology 9A');
    await expect(k.dlg).toHaveCount(0);
    await kiosk.getByRole('button', { name: 'Close kiosk' }).click();
    await expect(kiosk).toHaveCount(0);

    // Cleanup via the calendar (the dashboard dialog deletes just as well; this keeps the
    // teardown identical to the other specs').
    await page.goto('/calendar');
    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
  });
});
