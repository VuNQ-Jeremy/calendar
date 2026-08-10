import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Pictures on vocabulary words: attach one from the picker, see it on the word list and on the
 * flip card, then take it off again.
 *
 * Everything hangs off a throwaway topic so the seeded topics — which other specs and the seeded
 * results depend on — are never touched.
 *
 * The picker works here even though calendar-test has no ANTHROPIC_API_KEY: image search falls
 * back to Openverse, which needs no credentials at all. The "Draw one" button does need Workers AI
 * and takes several seconds, so it is deliberately not exercised — the deploy check covers that
 * path, and a spec that waits on a diffusion model would be the slowest thing in the suite.
 */

test.describe('CRUD: vocabulary word pictures', () => {
  crudGuard();

  test('word picture: attach from picker, render on card, remove', async ({ page }) => {
    const k = ui(page);
    const topic = `E2E image topic ${Date.now()}`;
    await signInStaff(page);
    await page.goto('/vocabulary');

    // ---- A throwaway topic to hold the word ----
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    const card = page.locator('.mochi-card.is-interactive', { hasText: topic });
    await expect(card).toBeVisible();
    // The title, not the card: a bare .click() lands in the card's centre, where the staff action
    // row swallows it (see crud-garden2.spec.ts).
    await page.locator('.mochi-card', { hasText: topic }).getByText(topic).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    const slug = new URL(page.url()).pathname;

    // ---- Add a word, and give it a picture from the search grid ----
    await page.getByRole('button', { name: 'Add word' }).click();
    const dlg = k.dlgOf('Add word');
    const f = k.on(dlg);
    await f.textIn('Word').fill('kitchen');
    await f.textIn('Meaning (Vietnamese)').fill('nhà bếp');

    // The picker opens pre-searched on the word, so candidates arrive without typing anything.
    await dlg.getByRole('button', { name: 'Find a picture' }).click();
    const picker = k.dlgOf('Choose a picture');
    await expect(picker).toBeVisible();

    // Wait for the grid rather than a fixed timeout: this is a live third-party search.
    const candidates = picker.locator('button:has(img)');
    await expect(candidates.first()).toBeVisible({ timeout: 45_000 });

    // Picking commits the picture to R2 straight away, so the response is the thing to await.
    const committed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/vocab-image-commit' && r.ok(),
      { timeout: 60_000 },
    );
    await candidates.first().click();
    await committed;

    // The dialog now shows the STORED picture, served from our own bucket.
    const preview = dlg.locator('img[src^="/flashcard-images/"]');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(dlg.getByRole('button', { name: 'Change picture' })).toBeVisible();

    post = k.posted(slug);
    await k.submit().click();
    await post;

    // ---- The word list shows a thumbnail, and it actually loads ----
    const row = page.locator('.lrow', { hasText: 'kitchen' });
    const thumb = row.locator('img[src^="/flashcard-images/"]');
    await expect(thumb).toBeVisible();
    // naturalWidth > 0 proves the capability URL served real bytes, not a 404.
    await expect
      .poll(async () => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    // ---- The picture appears on the front of the flip card ----
    await page.getByRole('button', { name: 'Flip cards' }).click();
    const cardImg = page.locator('img[src^="/flashcard-images/"]').first();
    await expect(cardImg).toBeVisible();
    // The word is still readable alongside it — the picture must not crowd it out.
    await expect(page.getByText('kitchen', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Exit' }).click();

    // ---- Remove it: the thumbnail goes, the word stays ----
    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = k.dlgOf('Edit word');
    await expect(edit.locator('img[src^="/flashcard-images/"]')).toBeVisible();
    await edit.getByRole('button', { name: 'Remove picture' }).click();
    await expect(edit.getByText('No picture yet')).toBeVisible();
    post = k.posted(slug);
    await k.on(edit).field('Word'); // keep the dialog scoped before submitting
    await edit.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    await expect(page.locator('.lrow', { hasText: 'kitchen' })).toBeVisible();
    await expect(
      page.locator('.lrow', { hasText: 'kitchen' }).locator('img[src^="/flashcard-images/"]'),
    ).toHaveCount(0);

    // ---- Clean up the throwaway topic ----
    await page.goto('/vocabulary');
    const back = page.locator('.mochi-card.is-interactive', { hasText: topic });
    await back.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.locator('.m-dialog:has-text("Delete")').last();
    post = k.posted('/vocabulary');
    await confirm.locator('.mochi-btn.is-danger, .mochi-btn.is-primary').last().click();
    await post;
    await expect(page.locator('.mochi-card.is-interactive', { hasText: topic })).toHaveCount(0);
  });
});
