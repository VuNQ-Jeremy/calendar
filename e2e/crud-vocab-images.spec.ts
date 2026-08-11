import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Pictures on vocabulary words: choose one from the editor's 3×3 picker, see it on the word list
 * and on the flip card, then take it off again.
 *
 * Everything hangs off a throwaway topic so the seeded topics — which other specs and the seeded
 * results depend on — are never touched.
 *
 * The picker works here even though calendar-test has no ANTHROPIC_API_KEY: image search falls back
 * to Openverse, which needs no credentials at all.
 */

/** A tile in the picker: a bare button wrapping an image. Blank cells are divs, so they miss. */
const TILE = 'button:has(> img)';

test.describe('CRUD: vocabulary word pictures', () => {
  crudGuard();

  test('word picture: pick from the strip, render on card, remove', async ({ page }) => {
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

    // ---- Add a word. The strip searches on its own once the word settles. ----
    await page.getByRole('button', { name: 'Add word' }).click();
    const dlg = k.dlgOf('Add word');
    const f = k.on(dlg);
    await f.textIn('Word').fill('kitchen');
    await f.textIn('Meaning (Vietnamese)').fill('nhà bếp');

    const strip = dlg.locator('.mochi-field:has(> label:text-is("Picture"))');
    // Wait for the batch rather than a fixed timeout: this is a live third-party search.
    await expect(strip.locator(TILE).first()).toBeVisible({ timeout: 45_000 });
    const tileCount = await strip.locator(TILE).count();
    // A grid of alternatives, not a single thumbnail, and never more than the nine cells it draws.
    expect(tileCount).toBeGreaterThan(1);
    expect(tileCount).toBeLessThanOrEqual(9);
    // The picker sits beside the fields, not under them: same column of the dialog as its label,
    // to the right of the word input.
    const wordBox = (await f.textIn('Word').boundingBox())!;
    const picsBox = (await strip.boundingBox())!;
    expect(picsBox.x).toBeGreaterThan(wordBox.x + wordBox.width);

    // The refresh button walks to the next batch. Awaited on the search response, since the
    // pictures that come back may legitimately look the same as the ones that went out.
    const refreshed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/vocab-image-search' && r.ok(),
      { timeout: 45_000 },
    );
    await strip.getByRole('button', { name: 'Show different pictures' }).click();
    await refreshed;
    await expect(strip.locator(TILE).first()).toBeVisible({ timeout: 45_000 });

    // Picking commits the picture to R2 straight away, so the response is the thing to await.
    const committed = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/vocab-image-commit' && r.ok(),
      { timeout: 60_000 },
    );
    await strip.locator(TILE).first().click();
    await committed;

    // The chosen tile is outlined, and it is the only one that is.
    await expect(strip.locator(`${TILE}[aria-pressed="true"]`)).toHaveCount(1);

    post = k.posted(slug);
    await k.submit().click();
    await post;

    // ---- The word list shows a thumbnail, and it actually loads ----
    const row = page.locator('.fc-wcard', { hasText: 'kitchen' });
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

    // ---- Remove it by tapping the outlined tile; the word stays ----
    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = k.dlgOf('Edit word');
    const editStrip = edit.locator('.mochi-field:has(> label:text-is("Picture"))');
    // An edit seeds the picker with the stored picture as the selection, so it is already outlined.
    const stored = editStrip.locator('button:has(> img[src^="/flashcard-images/"])');
    await expect(stored).toBeVisible();
    await stored.click();
    // Its tile goes with it, leaving nothing selected — the word can now be saved with no picture.
    await expect(stored).toHaveCount(0);
    await expect(editStrip.locator(`${TILE}[aria-pressed="true"]`)).toHaveCount(0);
    post = k.posted(slug);
    await edit.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    await expect(page.locator('.fc-wcard', { hasText: 'kitchen' })).toBeVisible();
    await expect(
      page.locator('.fc-wcard', { hasText: 'kitchen' }).locator('img[src^="/flashcard-images/"]'),
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
