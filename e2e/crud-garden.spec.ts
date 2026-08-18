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

    // A fresh topic, so the assignment row is unambiguous.
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    const card = page.locator('.mochi-card.is-interactive', { hasText: topic });
    await expect(card).toBeVisible();

    // "Assigned vocabulary" is the header button that opens the assignments dialog. Its
    // accessible name picks up the count Badge beside the label, so the match is a substring
    // one (Playwright's default) rather than exact.
    const openAssignments = page.getByRole('button', { name: 'Assigned vocabulary' });
    const listOf = () => k.dlgOf('Assigned vocabulary');

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

    // The header button grows a count badge, and the dialog behind it lists the assignment. The
    // topic CARD stays clean — it deliberately carries no "assigned" tag any more.
    //
    // The badge's PRESENCE, not its number: specs run in parallel against one test env and a
    // neighbouring one may have an assignment of its own out at the same time. Everything below
    // is scoped to this spec's own throwaway topic for the same reason.
    await expect(openAssignments.locator('.mochi-badge')).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toContainText('6:30 pm');
    await openAssignments.click();
    let row = listOf().locator('.lrow', { hasText: topic });
    await expect(row).toBeVisible();
    await expect(row).toContainText(CLASS);
    // The deadline prints its time beside the date.
    await expect(row).toContainText('6:30 pm');
    // The mode restriction shows as badges on the assignment row.
    await expect(row).toContainText('Unscramble');
    await expect(row).toContainText('Type it');

    // ---- Track it: nobody has played the new topic, so every member is behind. Progress opens
    // ON TOP of the list dialog rather than replacing it — Modal keeps a stack — so the list is
    // still there to go back to afterwards. ----
    await row.getByRole('button', { name: 'Progress' }).click();
    const track = k.dlgOf(`Progress · ${topic}`);
    await expect(track).toContainText(CLASS);
    // Leo Park is seeded into Biology 9A and has done none of it.
    await expect(track.locator('.lrow', { hasText: 'Leo Park' })).toContainText('0/2');
    await expect(track.getByText('Not done').first()).toBeVisible();
    // Scoped to the footer: the dialog's own X is also labelled "Close".
    await track.locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();
    await expect(row).toBeVisible();

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

    // ---- Deleting the topic warns that the assignment goes with it. The topic's own buttons are
    // on the page behind the list, so close the list first. ----
    await listOf().locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();
    await card.getByRole('button', { name: 'Delete' }).click();
    const confirm = k.dlgOf('Delete topic');
    await expect(confirm).toContainText(CLASS);
    await confirm.getByRole('button', { name: 'Cancel' }).click();

    // ---- Delete the assignment on its own; the topic and the earned rounds survive. The confirm
    // is raised by the PAGE's useConfirm, so it is a sibling of the list dialog, not a descendant
    // — `dlgOf('Delete assignment')` matches it alone. ----
    await openAssignments.click();
    row = listOf().locator('.lrow', { hasText: topic });
    await row.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete assignment').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(listOf().locator('.lrow', { hasText: topic })).toHaveCount(0);
    await listOf().locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();
    await expect(card).toBeVisible();

    // Cleanup.
    await card.getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: topic })).toHaveCount(0);
  });
});
