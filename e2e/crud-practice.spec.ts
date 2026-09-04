import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Practice (Nhiệm vụ): the teacher's whole loop on the SHEET — enable a class, type tasks into the
 * blank row, edit a cell in place, mark one student done, write feedback, read the standing strip,
 * switch tabs, filter, delete, disable. Runs on calendar-test only (crudGuard); every fixture is
 * prefixed E2E and the class is put back the way the seed left it.
 *
 * The Zalo assertion is split across two students on purpose: seed.sql pairs Leo Park's mother
 * (p1) to a chat and nobody else, so "No Zalo pairing" on Mia Chen and NOT on Leo proves the
 * indicator reads the pairing rather than defaulting.
 */
test.describe('CRUD: practice', () => {
  crudGuard();

  test('enable → blank row → edit cell → mark done → feedback → standing → filter → delete → disable', async ({
    page,
  }) => {
    const k = ui(page);
    const stamp = Date.now();
    const line1 = `E2E practice task A ${stamp}`;
    const line2 = `E2E practice task B ${stamp}`;
    const row = (title: string) => page.locator(`[data-testid="pr-row"][data-title="${title}"]`);

    await signInStaff(page);
    await page.goto('/practice');
    await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();

    // Enable for Biology 9A (seeded class c1). Guarded: a retry inherits the failed attempt's state.
    const bio = page.locator('.mochi-card', { hasText: 'Biology 9A' });
    if (await bio.getByRole('button', { name: 'Enable Practice' }).count()) {
      await bio.getByRole('button', { name: 'Enable Practice' }).click();
      const enabled = k.posted('/practice-actions');
      await k.dlgOf('Enable Practice').getByRole('button', { name: 'Save' }).click();
      await enabled;
    }
    await expect(bio.getByText('Practice on', { exact: true })).toBeVisible();

    // One way in.
    await bio.getByRole('link', { name: 'Open sheet' }).click();
    await page.waitForURL(/\/practice\/[^/]+\/\d{4}-\d{2}/);
    await page.getByRole('tab', { name: 'Leo Park' }).click();
    const today = page.locator('[data-testid="pr-day"][data-today="true"]');
    await expect(today).toBeVisible();

    // Every date band says what kind of day it is. Sunday is the one that is guaranteed in any
    // month and is off by RULE, so it carries its own kind rather than the "Day off" a teacher
    // chooses; a class day depends on this class's events and is not asserted here.
    await expect(page.locator('[data-testid="pr-day"][data-kind="sunday"]').first()).toBeVisible();
    await expect(page.getByText('Sunday', { exact: true }).first()).toBeVisible();
    expect(await today.getAttribute('data-kind')).toMatch(/^(class|practice|off|sunday)$/);

    // Today may be a day off by default (the derived mask skips this class's own lesson days).
    let forcedPracticeDay = false;
    if (await today.getByText('Day off', { exact: true }).count()) {
      await today.getByRole('button', { name: 'Day menu' }).click();
      const ov = k.posted('/practice-actions');
      await page.getByRole('menuitem', { name: 'Make practice day' }).click();
      await ov;
      forcedPracticeDay = true;
      await expect(today.getByText('Day off', { exact: true })).toHaveCount(0);
    }

    // The blank row is the row right after today's header. Two lines, Enter → two class tasks.
    const todayDate = await today.getAttribute('data-date');
    const blank = page.locator(`[data-testid="pr-blank"][data-date="${todayDate}"]`);
    await blank.getByRole('textbox', { name: 'Task' }).fill(`${line1}\n${line2}`);
    const added = k.posted('/practice-actions');
    await blank.getByRole('textbox', { name: 'Task' }).press('Enter');
    await added;
    await expect(row(line1)).toBeVisible();
    await expect(row(line2)).toBeVisible();

    // Edit task A's title in place: type, Enter commits.
    const titleA = row(line1).getByRole('textbox', { name: 'Task' });
    await titleA.fill(`${line1} edited`);
    const edited = k.posted('/practice-actions');
    await titleA.press('Enter');
    await edited;
    await expect(row(`${line1} edited`)).toBeVisible();

    // Mark Leo done on task B, right in the row.
    const done = k.posted('/practice-actions');
    await row(line2).getByRole('button', { name: 'Mark done' }).click();
    await done;
    await expect(row(line2).getByText('Done (teacher)', { exact: true })).toBeVisible();
    await expect(row(line2).getByText('Recorded by teacher', { exact: true })).toBeVisible();

    // Feedback saves on blur.
    const fb = row(line2).getByRole('textbox', { name: 'Feedback' });
    await fb.fill(`E2E feedback ${stamp}`);
    const saved = k.posted('/practice-actions');
    await fb.press('Tab');
    await saved;
    await expect(row(line2).getByText('Saved', { exact: true })).toBeVisible();

    // Standing strip: 1 of 2 for Leo, 0 of 2 for Mia, and the pairing indicator only on Mia.
    const leo = page.locator('[data-testid="pr-standing"]', { hasText: 'Leo Park' });
    const mia = page.locator('[data-testid="pr-standing"]', { hasText: 'Mia Chen' });
    await expect(leo.getByText('1 / 2', { exact: true })).toBeVisible();
    await expect(leo.getByText('No Zalo pairing', { exact: true })).toHaveCount(0);
    await expect(mia.getByText('0 / 2', { exact: true })).toBeVisible();
    await expect(mia.getByText('No Zalo pairing', { exact: true })).toBeVisible();

    // Mia's tab shows the same two class tasks, still open; the review filter has nothing for her.
    await page.getByRole('tab', { name: 'Mia Chen' }).click();
    await expect(row(`${line1} edited`)).toBeVisible();
    await expect(row(line2).getByRole('button', { name: 'Mark done' })).toBeVisible();
    await page.getByRole('button', { name: /^Needs review/ }).click();
    await expect(page.getByText('Nothing to review for Mia Chen', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(row(line2)).toBeVisible();

    // The breadcrumb trail is the way back to the class list. Scoped to .m-crumbs because the
    // sidebar carries its own "Practice" link.
    await expect(page.locator('.m-crumbs').getByRole('link', { name: 'Practice' })).toBeVisible();

    // Delete both class tasks (Leo's teacher_done copy of B survives by design; the row goes).
    for (const title of [`${line1} edited`, line2]) {
      await row(title).getByRole('button', { name: 'Delete task' }).click();
      const del = k.posted('/practice-actions');
      await k.confirmDanger('Delete task').click();
      await del;
      await expect(row(title)).toHaveCount(0);
    }

    // Put the day back on the weekly default if this run overrode it.
    if (forcedPracticeDay) {
      await today.getByRole('button', { name: 'Day menu' }).click();
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
