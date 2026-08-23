import { test, expect } from '@playwright/test';
import { crudGuard, eventTitleInput, pickDay, signInStaff, ui } from './crud-helpers';

/**
 * F-24: "Giao từ vựng" from the event dialog's Check-in tab, narrowed to a picked student
 * (vocab_assignment_students), and the vocab square it produces on the check-in kiosk.
 *
 * Everything hangs off a throwaway topic (the crud-garden.spec.ts convention) so the seeded
 * topics are never touched. The event's date is pinned explicitly and reused as the
 * assignment's deadline — for a one-off (non-recurring) event `deadlineInVocabWindow` degrades
 * to `deadline === date` (no previous occurrence to open the window from), so the two dates
 * must match exactly for the square to appear.
 */

test.describe('CRUD: vocab assignment scope', () => {
  crudGuard();

  test('assign to one student from the Check-in tab; vocab square appears, unmet', async ({
    page,
  }) => {
    const k = ui(page);
    const topic = `E2E scope topic ${Date.now()}`;
    const title = `E2E scope session ${Date.now()}`;
    // A few days out — comfortably not "today" in either the runner's or the server's ICT clock,
    // and the only thing both pickers below need is to agree with EACH OTHER on this one value.
    const target = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    await signInStaff(page);

    // ---- A throwaway topic, same as crud-garden.spec.ts's assignment CRUD spec. ----
    await page.goto('/vocabulary');
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    const card = page.locator('.mochi-card.is-interactive', { hasText: topic });
    await expect(card).toBeVisible();

    // ---- A one-off event on Biology 9A, dated `target`. ----
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'New event' }).click();
    await eventTitleInput(k.dlg).fill(title);
    await k.pickSel('Class', 'Biology 9A');
    await pickDay(page, 'Date', target);
    post = k.posted('/calendar');
    await k.submit().click();
    await post;

    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).click();
    await k.dlg.getByRole('tab', { name: 'Check-in/out' }).click();

    // ---- Assign, scoped to Leo Park only, deadline = the event's own date. ----
    await k.dlg
      .locator('.ck-section--assign')
      .getByRole('button', { name: 'Assign vocabulary' })
      .click();
    const assignDlg = k.dlgOf('Assign vocabulary');
    const f = k.on(assignDlg);
    await f.pickSel('Topic', topic);
    await pickDay(page, 'Due date', target);
    await assignDlg.locator('.mochi-check', { hasText: 'Selected students' }).click();
    await assignDlg.locator('.mochi-check', { hasText: 'Leo Park' }).click();
    post = k.posted('/vocabulary');
    await assignDlg.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;

    // The section's own list picks the new assignment up (the assign success handler marks the
    // occurrence's `ck:` cache stale itself — this section does not rely on the live broadcast).
    const row = k.dlg.locator('.ck-section--assign .lrow', { hasText: topic });
    await expect(row).toBeVisible();
    await expect(row.locator('.mchip')).toHaveText('1 selected');

    // ---- The kiosk's FIRST fetch for this occurrence happens only now, after the assignment
    // exists, so its vocab-window read sees it straight away. ----
    const kiosk = page.locator('.kiosk-overlay');
    await k.dlg
      .locator('.ck-section--this')
      .getByRole('button', { name: 'Open check-in kiosk' })
      .click();
    await kiosk.locator('.kiosk-card', { hasText: 'Leo Park' }).click();
    const cell = kiosk.locator('.kiosk-cell--special');
    await expect(cell).toHaveCount(1);
    await expect(cell.locator('.kiosk-cell-type')).toHaveText('Vocabulary');
    // Leo Park has played zero rounds of a topic created seconds ago — unmet, not pre-checked.
    await expect(cell.locator('.kiosk-cell-check')).toHaveCount(0);
    await kiosk.getByRole('button', { name: 'Close kiosk' }).click();

    // ---- Cleanup: the event, then the topic (cascades the assignment and its scope row away). ----
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;

    await page.goto('/vocabulary');
    await card.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: topic })).toHaveCount(0);
  });
});
