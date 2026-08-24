import { test, expect } from '@playwright/test';
import { crudGuard, eventTitleInput, signInStaff, ui } from './crud-helpers';

/**
 * F-24 special squares: the homework square mirrors session_previews.homework_text (written on
 * the "Next session" tab of the SAME occurrence — there is no previous-occurrence lookup for
 * homework, unlike the vocab square). Non-empty text seeds a `kind='homework'` checklist row on
 * the next /checkin fetch; the kiosk renders it as a distinctly-framed cell; clearing the text
 * deletes the row and its taps together (deleteItem's documented contract).
 *
 * Every `ck:*` cache key here is fetched at most once before being asserted on — editing
 * session_previews is a DIFFERENT live domain ('previews') from checkin's own ('checkin'), so it
 * does not invalidate an already-cached `ck:` payload (see shared/live.ts / route-cache.ts). The
 * "square disappears" half therefore forces a `page.reload()` before reopening, the same pattern
 * crud-garden3.spec.ts uses to observe a just-saved server change.
 */

test.describe('CRUD: check-in special squares', () => {
  crudGuard();

  test('homework text seeds a kiosk square; clearing it removes the square and its taps', async ({
    page,
  }) => {
    const k = ui(page);
    const title = `E2E hw square ${Date.now()}`;

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

    // Author the homework text on the "Next session" tab — the FIRST visit to any `ck:` key for
    // this occurrence happens only after this save, so the Check-in/out tab's later fetch sees it.
    await k.dlg.getByRole('tab', { name: 'Next session' }).click();
    await k.textIn('Homework (checked at next check-in)').fill('Workbook p.32');
    post = k.posted('/event-previews');
    await k.dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await post;

    // The authoring tab shows the seeded square as a read-only chip, not an editable row.
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();
    const chip = k.dlg.locator('.ck-special-chip[data-kind="homework"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Workbook p.32');

    // On the kiosk it is a tappable, distinctly-framed cell — same tap path as any other cell.
    const kiosk = page.locator('.kiosk-overlay');
    await k.dlg
      .locator('.ck-section--this')
      .getByRole('button', { name: 'Open check-in kiosk' })
      .click();
    await kiosk.locator('.kiosk-card', { hasText: 'Leo Park' }).click();
    // Homework sits in the specials row and stays tappable — it is the manual one.
    const cell = kiosk.locator('.kiosk-cells--special .kiosk-cell--special');
    await expect(cell).toHaveCount(1);
    await expect(cell.locator('.kiosk-cell-type')).toHaveText('Homework');
    await expect(cell.locator('.kiosk-cell-label')).toHaveText('Workbook p.32');

    let tap = k.posted('/checkin');
    await cell.click();
    await tap;
    await expect(cell.locator('.kiosk-cell-check')).toBeVisible();

    // Idempotent re-tap: uncheck then re-check, same contract every other kiosk cell has.
    tap = k.posted('/checkin');
    await cell.click();
    await tap;
    await expect(cell.locator('.kiosk-cell-check')).toHaveCount(0);
    tap = k.posted('/checkin');
    await cell.click();
    await tap;
    await expect(cell.locator('.kiosk-cell-check')).toBeVisible();

    await kiosk.getByRole('button', { name: 'Close kiosk' }).click();

    // Clear the homework text — the square (and its taps) is deleted on the NEXT fetch.
    await k.dlg.getByRole('tab', { name: 'Next session' }).click();
    await k.textIn('Homework (checked at next check-in)').fill('');
    post = k.posted('/event-previews');
    await k.dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await post;

    // Force a fresh client-side cache: the 'previews' live domain does not invalidate `ck:*`
    // keys, so without this the Check-in/out tab and kiosk would keep serving the payload
    // fetched before the text was cleared.
    await page.reload();
    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).click();
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();
    await expect(k.dlg.locator('.ck-special-chip[data-kind="homework"]')).toHaveCount(0);

    await k.dlg
      .locator('.ck-section--this')
      .getByRole('button', { name: 'Open check-in kiosk' })
      .click();
    // With no authored items and the homework square gone, the board has nothing to show — the
    // same empty state a checklist-less occurrence renders today (see crud-kiosk.spec.ts).
    await expect(kiosk.locator('.kiosk-empty')).toBeVisible();
    await kiosk.getByRole('button', { name: 'Close kiosk' }).click();

    // Cleanup: delete the (one-off) event.
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
  });

  test("next session's homework is authored from THIS session's Check-in tab", async ({ page }) => {
    const k = ui(page);
    const title = `E2E hw next ${Date.now()}`;

    // Weekly, so the "Check-in for next session" section (and its homework field) renders.
    await signInStaff(page);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await eventTitleInput(k.dlg).fill(title);
    await k.pickSel('Class', 'Biology 9A');
    await k.pickSel('Repeat', 'Every week');
    let post = k.posted('/calendar');
    await k.submit().click();
    await post;

    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).first().click();
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();

    // The homework field lives in the next-session section and writes NEXT week's preview row.
    const nextSection = k.dlg.locator('.ck-section--next');
    const hwBox = nextSection.locator('textarea.mochi-input');
    const addBtn = nextSection.getByRole('button', { name: 'Add', exact: true });
    await hwBox.fill('Workbook p.40');
    post = k.posted('/event-previews');
    await addBtn.click();
    await post;

    // The save marks next week's checklist stale, the refetch seeds the square, and the chip
    // appears right in this section — the teacher sees the result without leaving the dialog.
    // (Next week's date is in the future, so the seeder's no-retroactive-squares guard allows it.)
    const chip = nextSection.locator('.ck-special-chip[data-kind="homework"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Workbook p.40');
    // The box empties and Add re-disables: it is an add-a-line input, not a copy of the value.
    await expect(hwBox).toHaveValue('');
    await expect(addBtn).toBeDisabled();

    // A second save APPENDS rather than replacing — one field, one line per entry.
    await hwBox.fill('Read chapter 4');
    post = k.posted('/event-previews');
    await addBtn.click();
    await post;
    await expect(chip).toContainText('Workbook p.40');
    await expect(chip).toContainText('Read chapter 4');

    // Clear is the one path that removes what accumulated; the square goes with it.
    post = k.posted('/event-previews');
    await nextSection.getByRole('button', { name: 'Clear homework' }).click();
    await post;
    await expect(nextSection.locator('.ck-special-chip[data-kind="homework"]')).toHaveCount(0);

    // Cleanup: weekly events raise the scope chooser on delete (crud-checkin-author pattern).
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    const chooser = k.dlgOf('Delete recurring event');
    await k.dlg.first().locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await chooser.getByRole('radio', { name: 'All events' }).check();
    await chooser.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
  });
});
