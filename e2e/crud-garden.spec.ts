import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Giao bài từ vựng — the teacher's side of the garden: assign a topic to a class, track who has
 * done it, edit the ask, and delete it again.
 *
 * Everything hangs off a throwaway topic, so the seeded topics (which other specs and the seeded
 * results depend on) are never assigned or deleted. The class is the seeded Biology 9A, whose
 * three members give the tracking table real rows.
 */

const CLASS = 'Biology 9A';

test.describe('CRUD: vocabulary assignments', () => {
  crudGuard();

  test('assignment: create, track, edit, delete', async ({ page }) => {
    const k = ui(page);
    const topic = `E2E garden topic ${Date.now()}`;
    await signInStaff(page);
    await page.goto('/vocabulary');

    // A fresh topic, so the assignment panel and the "assigned" tag are unambiguous.
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    // `.is-interactive` picks the topic card out of the grid: the assignments panel below also
    // carries the topic name, and an unscoped `.mochi-card` would match both.
    const card = page.locator('.mochi-card.is-interactive', { hasText: topic });
    await expect(card).toBeVisible();

    // ---- Assign it. The default deadline is a week out, so the date picker stays shut. ----
    await card.getByRole('button', { name: 'Assign' }).click();
    const dlg = k.dlgOf('Assign vocabulary');
    await expect(dlg).toContainText(topic);
    const f = k.on(dlg);
    await f.pickSel('Class', CLASS);
    await f.textIn('Rounds required').fill('2');
    await f.textIn('Minimum score (%)').fill('50');
    await f.textIn('Questions per round').fill('15');
    // The due TIME is optional — it opens on "End of day", the meaning a deadline has always had.
    // Picking one narrows the deadline to that instant. Blocks are 30 minutes apart, so "6:30 pm"
    // is on the list where "6:15 pm" would not be.
    await expect(f.field('Due time')).toContainText('End of day');
    await f.pickSel('Due time', '6:30 pm');
    // Restrict which game modes count. Unchecked (the default) means any mode, so the hint is
    // showing before the first tick and disappears after it. The DS checkbox hides its native
    // input behind a styled span, so ticking clicks the LABEL; asserting reads the input, which
    // toBeChecked() accepts hidden.
    await expect(dlg.getByText('Any mode counts')).toBeVisible();
    // The featured "Mixed round" chip lives in the same checkbox group as the plain modes.
    // Assert the CHIP, not the input: per the note above the native input is hidden behind the
    // styled span, so toBeVisible() on it can never pass (toBeChecked, used below, is the one
    // matcher that tolerates a hidden input).
    await expect(dlg.locator('.mochi-check', { hasText: 'Mixed round' })).toBeVisible();
    await expect(dlg.getByText('Recommended')).toBeVisible();
    await dlg.locator('.mochi-check', { hasText: 'Unscramble' }).click();
    await dlg.locator('.mochi-check', { hasText: 'Type it' }).click();
    await expect(dlg.getByRole('checkbox', { name: 'Unscramble' })).toBeChecked();
    await expect(dlg.getByText('Any mode counts')).toHaveCount(0);
    post = k.posted('/vocabulary');
    await dlg.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;

    // The card grows an "Assigned · due …" tag, and the panel below lists the assignment.
    await expect(card).toContainText('Assigned', { timeout: 15_000 });
    const panel = page.locator('.mochi-card', {
      has: page.getByText('Assigned vocabulary', { exact: true }),
    });
    const row = panel.locator('.lrow', { hasText: topic });
    await expect(row).toBeVisible();
    await expect(row).toContainText(CLASS);
    // The deadline now prints its time beside the date, here and on the topic card's tag.
    await expect(row).toContainText('6:30 pm');
    await expect(card).toContainText('6:30 pm');
    // The mode restriction shows as badges on the assignment row.
    await expect(row).toContainText('Unscramble');
    await expect(row).toContainText('Type it');

    // ---- Track it: nobody has played the new topic, so every member is behind. ----
    await row.getByRole('button', { name: 'Progress' }).click();
    const track = k.dlgOf(`Progress · ${topic}`);
    await expect(track).toContainText(CLASS);
    // Leo Park is seeded into Biology 9A and has done none of it.
    await expect(track.locator('.lrow', { hasText: 'Leo Park' })).toContainText('0/2');
    await expect(track.getByText('Not done').first()).toBeVisible();
    // Scoped to the footer: the dialog's own X is also labelled "Close".
    await track.locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();

    // ---- Edit the ask. The saved mode restriction comes back checked; clearing it returns the
    // assignment to any-mode counting and drops the badges. ----
    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = k.dlgOf('Edit assignment');
    await expect(edit.getByRole('checkbox', { name: 'Unscramble' })).toBeChecked();
    await expect(edit.getByRole('checkbox', { name: 'Type it' })).toBeChecked();
    await expect(edit.getByRole('checkbox', { name: 'Quiz', exact: true })).not.toBeChecked();
    // The question count saved on create comes back unchanged.
    await expect(k.on(edit).textIn('Questions per round')).toHaveValue('15');
    await edit.locator('.mochi-check', { hasText: 'Unscramble' }).click();
    await edit.locator('.mochi-check', { hasText: 'Type it' }).click();
    await expect(edit.getByRole('checkbox', { name: 'Unscramble' })).not.toBeChecked();
    // The saved due time comes back on the trigger, and can be handed back to "End of day".
    await expect(k.on(edit).field('Due time')).toContainText('6:30 pm');
    await k.on(edit).pickSel('Due time', 'End of day');
    await k.on(edit).textIn('Rounds required').fill('5');
    post = k.posted('/vocabulary');
    await edit.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    // Wait for the LIST to catch up before reopening the tracking modal: the modal renders the
    // row it was handed, so asserting on it first would only re-read the pre-edit snapshot.
    await expect(row).toContainText('Rounds required: 5');
    await expect(row.getByText('Unscramble')).toHaveCount(0);
    await expect(row.getByText('6:30 pm')).toHaveCount(0);
    await row.getByRole('button', { name: 'Progress' }).click();
    const track2 = k.dlgOf(`Progress · ${topic}`);
    await expect(track2.locator('.lrow', { hasText: 'Leo Park' })).toContainText('0/5');
    await track2.locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();

    // ---- Deleting the topic warns that the assignment goes with it. ----
    await card.getByRole('button', { name: 'Delete' }).click();
    const confirm = k.dlgOf('Delete topic');
    await expect(confirm).toContainText(CLASS);
    await confirm.getByRole('button', { name: 'Cancel' }).click();

    // ---- Delete the assignment on its own; the topic and the earned rounds survive. ----
    await row.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete assignment').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(panel.locator('.lrow', { hasText: topic })).toHaveCount(0);
    await expect(card).toBeVisible();

    // Cleanup.
    await card.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: topic })).toHaveCount(0);
  });
});
