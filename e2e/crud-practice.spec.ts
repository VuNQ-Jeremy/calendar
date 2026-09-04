import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Practice (Nhiệm vụ): the teacher's whole web loop through the real dialogs — enable a class,
 * plan a day with quick add, edit and delete a task, mark one student done, read the ledger, and
 * disable again. Runs on calendar-test only (crudGuard); every fixture is prefixed E2E and the
 * class is put back the way the seed left it.
 *
 * The Zalo assertion is deliberately split across two students: seed.sql pairs Leo Park's mother
 * (p1) to a chat and nobody else, so "No Zalo pairing" appearing on Mia Chen and NOT on Leo is
 * what proves the indicator is reading the pairing rather than defaulting.
 */
test.describe('CRUD: practice', () => {
  crudGuard();

  test('enable → quick add → edit → mark done → ledger → delete → disable', async ({ page }) => {
    const k = ui(page);
    const stamp = Date.now();
    const line1 = `E2E practice task A ${stamp}`;
    const line2 = `E2E practice task B ${stamp}`;

    await signInStaff(page);
    await page.goto('/practice');
    await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();

    // Enable for Biology 9A (seeded class c1, with Leo Park enrolled). Guarded, because this
    // spec's own retry inherits whatever state the failed attempt left behind.
    const bio = page.locator('.mochi-card', { hasText: 'Biology 9A' });
    if (await bio.getByRole('button', { name: 'Enable Practice' }).count()) {
      await bio.getByRole('button', { name: 'Enable Practice' }).click();
      const enabled = k.posted('/practice-actions');
      await k.dlgOf('Enable Practice').getByRole('button', { name: 'Save' }).click();
      await enabled;
    }
    await expect(bio.getByText('Practice on', { exact: true })).toBeVisible();

    // Open this week's grid and quick-add two tasks on today's column.
    await bio.getByRole('link', { name: 'Open week' }).click();
    await page.waitForURL(/\/practice\/[^/]+\/week\/\d{4}-\d{2}-\d{2}/);
    const todayCol = page.locator('[data-testid="pr-day"][data-today="true"]');
    await expect(todayCol).toBeVisible();

    // Today may be a day off by default (the derived mask skips this class's own lesson days).
    let forcedPracticeDay = false;
    if (await todayCol.getByText('Day off', { exact: true }).count()) {
      await todayCol.getByRole('button', { name: 'Day menu' }).click();
      const ov = k.posted('/practice-actions');
      await page.getByRole('menuitem', { name: 'Make practice day' }).click();
      await ov;
      forcedPracticeDay = true;
      await expect(todayCol.getByText('Day off', { exact: true })).toHaveCount(0);
    }

    await todayCol.getByRole('button', { name: 'Add tasks' }).click();
    const dlg = k.dlgOf('Add tasks');
    await k.on(dlg).textIn('Tasks (one per line)').fill(`${line1}\n${line2}`);
    await k.on(dlg).pickSel('Proof', 'No proof needed');
    const added = k.posted('/practice-actions');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await added;
    await expect(todayCol.getByText(line1, { exact: true })).toBeVisible();
    await expect(todayCol.getByText(line2, { exact: true })).toBeVisible();

    // Edit task A.
    const cardA = todayCol.locator('.mochi-card', { hasText: line1 });
    await cardA.getByRole('button', { name: 'Edit task' }).click();
    const edit = k.dlgOf('Edit task');
    await k.on(edit).textIn('Task').fill(`${line1} edited`);
    const edited = k.posted('/practice-actions');
    await edit.getByRole('button', { name: 'Save' }).click();
    await edited;
    await expect(todayCol.getByText(`${line1} edited`, { exact: true })).toBeVisible();

    // Mark Leo Park done on task B from the students dialog.
    await todayCol.getByRole('button', { name: 'Students on this day' }).click();
    const students = k.dlgOf('Students on this day');
    const leo = students.locator('[data-testid="pr-student-row"]', { hasText: 'Leo Park' });
    const done = k.posted('/practice-actions');
    await leo
      .locator('[data-testid="pr-copy"]', { hasText: line2 })
      .getByRole('button', { name: 'Mark done' })
      .click();
    await done;
    await expect(
      leo
        .locator('[data-testid="pr-copy"]', { hasText: line2 })
        .getByText('Recorded by teacher', { exact: true }),
    ).toBeVisible();
    // The footer button, not the dialog's own X — both are named "Close".
    await students.locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();

    // Ledger: 1 of 2 done for Leo, and the pairing indicator on the family that has none.
    await page.getByRole('link', { name: 'Ledger' }).click();
    await page.waitForURL(/\/practice\/[^/]+\/ledger\/\d{4}-\d{2}/);
    const leoRow = page.locator('tr', { hasText: 'Leo Park' });
    await expect(leoRow.getByText('1 / 2', { exact: true })).toBeVisible();
    await expect(leoRow.getByText('No Zalo pairing', { exact: true })).toHaveCount(0);
    const miaRow = page.locator('tr', { hasText: 'Mia Chen' });
    await expect(miaRow.getByText('0 / 2', { exact: true })).toBeVisible();
    await expect(miaRow.getByText('No Zalo pairing', { exact: true })).toBeVisible();

    // The breadcrumb trail is the way back out of a page two levels in — the sidebar only
    // highlights the section, so without this the ledger has no exit but the browser button.
    // Scoped to .m-crumbs because the sidebar carries its own "Practice" link.
    const crumbs = page.locator('.m-crumbs');
    await expect(crumbs.getByRole('link', { name: 'Practice' })).toBeVisible();
    await crumbs.getByRole('link', { name: 'Biology 9A' }).click();
    await page.waitForURL(/\/practice\/[^/]+\/week\/\d{4}-\d{2}-\d{2}/);

    // Delete both tasks (B's teacher_done copy survives by design, the task row does not).
    await expect(todayCol).toBeVisible();
    for (const title of [`${line1} edited`, line2]) {
      const card = todayCol.locator('.mochi-card', { hasText: title });
      await card.getByRole('button', { name: 'Delete task' }).click();
      const del = k.posted('/practice-actions');
      await k.confirmDanger('Delete task').click();
      await del;
      await expect(card).toHaveCount(0);
    }

    // Put the day back on the weekly default if this run overrode it.
    if (forcedPracticeDay) {
      await todayCol.getByRole('button', { name: 'Day menu' }).click();
      const reset = k.posted('/practice-actions');
      await page.getByRole('menuitem', { name: 'Use weekly default' }).click();
      await reset;
    }

    // Disable Practice again so other specs see the seeded state.
    await page.goto('/practice');
    await bio.getByRole('button', { name: 'Disable Practice' }).click();
    const disabled = k.posted('/practice-actions');
    await k.confirmDanger('Disable Practice').click();
    await disabled;
    await expect(bio.getByRole('button', { name: 'Enable Practice' })).toBeVisible();
  });
});
