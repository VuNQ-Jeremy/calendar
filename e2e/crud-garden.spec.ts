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

    // ---- Track it: nobody has played the new topic, so every member is behind. ----
    await row.getByRole('button', { name: 'Progress' }).click();
    const track = k.dlgOf(`Progress · ${topic}`);
    await expect(track).toContainText(CLASS);
    // Leo Park is seeded into Biology 9A and has done none of it.
    await expect(track.locator('.lrow', { hasText: 'Leo Park' })).toContainText('0/2');
    await expect(track.getByText('Not done').first()).toBeVisible();
    // Scoped to the footer: the dialog's own X is also labelled "Close".
    await track.locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();

    // ---- Edit the ask. ----
    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = k.dlgOf('Edit assignment');
    await k.on(edit).textIn('Rounds required').fill('5');
    post = k.posted('/vocabulary');
    await edit.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    // Wait for the LIST to catch up before reopening the tracking modal: the modal renders the
    // row it was handed, so asserting on it first would only re-read the pre-edit snapshot.
    await expect(row).toContainText('Rounds required: 5');
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
