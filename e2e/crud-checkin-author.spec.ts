import { test, expect } from '@playwright/test';
import { crudGuard, eventTitleInput, pickDay, signInStaff, ui } from './crud-helpers';

/**
 * The event dialog's Check-in/out tab: authoring this session's check-in list, a
 * check-out list, and (for a recurring class) the separate "check-in buổi sau" list
 * for the NEXT occurrence. Requires at least one active check-in activity type, so the
 * spec creates one via /config first and cleans it up at the end.
 */

test.describe('CRUD: check-in/out authoring', () => {
  crudGuard();

  test('add and remove check-in and check-out items on a recurring class event', async ({
    page,
  }) => {
    const k = ui(page);
    const typeName = `E2E activity ${Date.now()}`;

    // A check-in item needs a managed activity type to pick from.
    await signInStaff(page);
    await page.goto('/config');
    const typesCard = page.locator('.cfg-row', { hasText: 'Check-in activities' });
    await typesCard.click();
    const cfgDlg = page.locator('.m-dialog:has(.m-dialog__title:text-is("Check-in activities"))');
    await cfgDlg.getByRole('button', { name: 'Add activity' }).click();
    await k.dlgOf('Add activity').locator('input.mochi-input').fill(typeName);
    let post = k.posted('/config');
    await k.submit().click();
    await post;
    await page.keyboard.press('Escape');

    // A recurring (weekly) class event so the "check-in buổi sau" section renders.
    const title = `E2E checkin session ${Date.now()}`;
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await eventTitleInput(k.dlg).fill(title);
    await k.pickSel('Class', 'Biology 9A');
    await k.pickSel('Repeat', 'Every week');
    post = k.posted('/calendar');
    await k.submit().click();
    await post;

    await page.getByRole('tab', { name: 'Agenda' }).click();
    // 'Every week' above means the agenda lists several occurrences of this same event — open the
    // earliest one rather than matching them all.
    await page.locator('.aev', { hasText: title }).first().click();
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();

    // --- This session's check-in list ---
    const thisSection = k.dlg.locator('.ck-section--this');
    post = k.posted('/checkin');
    await thisSection.getByRole('button', { name: 'Add item' }).click();
    await post;
    const thisRow = thisSection.locator('.ck-item-row');
    await expect(thisRow).toHaveCount(1);
    // A new row picks no activity — it must not inherit the first type, or the row above.
    await expect(thisRow.locator('.m-select__value')).toHaveText('Not chosen yet');
    post = k.posted('/checkin');
    await thisRow.locator('button.m-select__trigger').click();
    await page.getByRole('option', { name: typeName, exact: true }).click();
    await post;
    await expect(thisRow.locator('.m-select__value')).toHaveText(typeName);
    post = k.posted('/checkin');
    await thisRow.locator('input.mochi-input').fill('10 từ vựng chủ đề Animals');
    await thisRow.locator('input.mochi-input').blur();
    await post;

    // --- Check-in for next session ---
    const nextSection = k.dlg.locator('.ck-section--next');
    post = k.posted('/checkin');
    await nextSection.getByRole('button', { name: 'Add item' }).click();
    await post;
    await expect(nextSection.locator('.ck-item-row')).toHaveCount(1);

    // --- Check-out list (free text, no type picker) ---
    const outSection = k.dlg.locator('.ck-section--checkout');
    post = k.posted('/checkin');
    await outSection.getByRole('button', { name: 'Add item' }).click();
    await post;
    const outRow = outSection.locator('.ck-item-row').last();
    post = k.posted('/checkin');
    await outRow.locator('input.mochi-input').fill('Đếm từ 1 đến 20');
    await outRow.locator('input.mochi-input').blur();
    await post;

    // Delete the check-in item just added — the row disappears.
    post = k.posted('/checkin');
    await thisRow.getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(thisRow).toHaveCount(0);

    // Cleanup: delete the event, then the throwaway activity type.
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;

    await page.goto('/config');
    await typesCard.click();
    const row = page.locator('.lrow', { hasText: typeName });
    post = k.posted('/config');
    await row.getByRole('button', { name: 'Delete' }).click();
    await k.confirmDanger('Delete this activity?').click();
    await post;
  });

  test('an authored checklist follows the event when it is rescheduled', async ({ page }) => {
    const k = ui(page);
    const title = `E2E reschedule ${Date.now()}`;
    const label = 'Thuộc 3 cấu trúc câu';
    // Checklist items key on (event_id, date), so moving the event used to strand them on the
    // old date — the teacher's authoring simply vanished. Two days out so the "next month" hop
    // in pickDay is the only calendar navigation either date needs.
    const target = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    await signInStaff(page);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await eventTitleInput(k.dlg).fill(title);
    await k.pickSel('Class', 'Biology 9A');
    let post = k.posted('/calendar');
    await k.submit().click();
    await post;

    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).click();
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();
    const thisSection = k.dlg.locator('.ck-section--this');
    post = k.posted('/checkin');
    await thisSection.getByRole('button', { name: 'Add item' }).click();
    await post;
    post = k.posted('/checkin');
    await thisSection.locator('input.mochi-input').fill(label);
    await thisSection.locator('input.mochi-input').blur();
    await post;

    // Reschedule from the Details tab.
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    await pickDay(page, 'Date', target);
    post = k.posted('/calendar');
    await k.submit().click();
    await post;

    // Reopen at the new date — the item came along.
    //
    // Scoped to the TARGET day's group, and that scoping is load-bearing twice over. The check-in
    // tab reads items for the occurrence the dialog was opened AT, so opening the stale row still
    // sitting under the old date queries (event_id, old date) and finds nothing. It also doubles
    // as the wait: awaiting the POST only proves the server moved the row, and the agenda has its
    // own revalidation to finish before the event appears under its new heading.
    const targetDayNum = String(Number(target.slice(8, 10)));
    const targetDay = page.locator('.agenda__day').filter({
      has: page.locator('.agenda__dnum', { hasText: new RegExp(`^${targetDayNum}$`) }),
    });
    const movedEvent = targetDay.locator('.aev', { hasText: title });
    await expect(movedEvent).toBeVisible();
    await movedEvent.click();
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();
    await expect(thisSection.locator('input.mochi-input')).toHaveValue(label);

    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
  });
});
