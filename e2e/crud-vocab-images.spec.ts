import { test, expect, type Locator, type Page } from '@playwright/test';
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

    // ---- The saved picture survives trying a candidate, and comes off on a second tap ----
    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = k.dlgOf('Edit word');
    const editStrip = edit.locator('.mochi-field:has(> label:text-is("Picture"))');
    // An edit seeds the picker with the stored picture as the selection, so it is already outlined.
    const stored = editStrip.locator('button:has(> img[src^="/flashcard-images/"])');
    await expect(stored).toHaveAttribute('aria-pressed', 'true');

    // The dialog searches on open even though the word has a picture, so alternatives arrive beside
    // it. Trying one moves the outline but must NOT take the word's own picture off screen — the
    // switch stays undoable until save.
    const alt = editStrip.locator(`${TILE}:not(:has(img[src^="/flashcard-images/"]))`).first();
    await expect(alt).toBeVisible({ timeout: 45_000 });
    const recommitted = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/vocab-image-commit' && r.ok(),
      { timeout: 60_000 },
    );
    await alt.click();
    await recommitted;
    await expect(stored).toBeVisible();
    await expect(stored).toHaveAttribute('aria-pressed', 'false');
    await expect(editStrip.locator(`${TILE}[aria-pressed="true"]`)).toHaveCount(1);

    // One tap goes back to it...
    await stored.click();
    await expect(stored).toHaveAttribute('aria-pressed', 'true');
    // ...and tapping the outlined picture clears it, leaving nothing selected. The tile stays put,
    // so the teacher can still change their mind before saving.
    await stored.click();
    await expect(editStrip.locator(`${TILE}[aria-pressed="true"]`)).toHaveCount(0);
    await expect(stored).toBeVisible();
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

  /**
   * Refreshing the picker mid-pick used to poison the save.
   *
   * Copying a stock photo into R2 is a multi-hop round trip, so a teacher who taps a cell, hits
   * "Show different pictures", and taps another has two copies in flight at once. Whichever answered
   * last decided what the word was saved with — usually the FIRST one, because it had a head start —
   * so the word came out holding the picture from before the refresh. The two specs below pin the
   * invariant that broke: `imageKey` describes the last cell tapped, and nothing else.
   */

  /** A cell that is not the current selection — tapping the selected one clears it instead. */
  const UNPICKED = 'button[aria-pressed="false"]:has(> img)';

  /** Throwaway topic with its "Add word" dialog open. Returns the topic's slug and its picker. */
  async function wordDialogOnFreshTopic(page: Page, word: string) {
    const k = ui(page);
    const topic = `E2E image topic ${Date.now()}`;
    await signInStaff(page);
    await page.goto('/vocabulary');
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    const post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    await page.locator('.mochi-card', { hasText: topic }).getByText(topic).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    const slug = new URL(page.url()).pathname;

    await page.getByRole('button', { name: 'Add word' }).click();
    const dlg = k.dlgOf('Add word');
    const f = k.on(dlg);
    await f.textIn('Word').fill(word);
    await f.textIn('Meaning (Vietnamese)').fill('nghĩa');
    const strip = dlg.locator('.mochi-field:has(> label:text-is("Picture"))');
    // A live third-party search, so wait for the batch rather than a fixed timeout.
    await expect(strip.locator(TILE).first()).toBeVisible({ timeout: 45_000 });
    return { k, topic, slug, strip };
  }

  /** Walk to the next batch and hand back a cell that is not the current pick. */
  async function refreshPicker(page: Page, strip: Locator) {
    const searched = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/vocab-image-search' && r.ok(),
      { timeout: 45_000 },
    );
    await strip.getByRole('button', { name: 'Show different pictures' }).click();
    await searched;
    const fresh = strip.locator(UNPICKED).first();
    await expect(fresh).toBeVisible({ timeout: 45_000 });
    return fresh;
  }

  async function deleteTopic(page: Page, k: ReturnType<typeof ui>, topic: string) {
    await page.goto('/vocabulary');
    await page
      .locator('.mochi-card.is-interactive', { hasText: topic })
      .getByRole('button', { name: 'Delete' })
      .click();
    const confirm = page.locator('.m-dialog:has-text("Delete")').last();
    const post = k.posted('/vocabulary');
    await confirm.locator('.mochi-btn.is-danger, .mochi-btn.is-primary').last().click();
    await post;
  }

  const fileOf = (imageKey: string) => imageKey.slice(imageKey.indexOf('/') + 1);

  test('word picture: a pick made after refreshing wins, even if the earlier copy lands last', async ({
    page,
  }) => {
    // Keyed by REQUEST order, not completion order — the point of the spec is that the two answers
    // come back in the wrong order, so which one finished first must not decide the bookkeeping.
    const committed: Record<number, string> = {};
    let seen = 0;
    let staleLanded = false;
    // Hold the first copy back so it answers AFTER the second — the out-of-order case, forced.
    // Without the delay the race is real but rarely lost, and the spec would pass on both codepaths.
    await page.route('**/vocab-image-commit', async (route) => {
      const n = ++seen;
      const res = await route.fetch();
      const body = await res.text();
      committed[n] = JSON.parse(body).data.imageKey as string;
      if (n === 1) {
        await new Promise((r) => setTimeout(r, 8_000));
        await route.fulfill({ response: res, body });
        staleLanded = true;
        return;
      }
      await route.fulfill({ response: res, body });
    });

    const { k, topic, slug, strip } = await wordDialogOnFreshTopic(page, 'harbour');

    // ---- First pick, then refresh and pick again while its copy is still in flight ----
    await strip.locator(TILE).first().click();
    await expect.poll(() => committed[1], { timeout: 60_000 }).toBeTruthy();
    const fresh = await refreshPicker(page, strip);
    await fresh.click();
    await expect.poll(() => committed[2], { timeout: 60_000 }).toBeTruthy();
    // Save only once the held-back first answer has reached the page: applying it late is the bug,
    // and saving before it arrives would let a broken build pass.
    await expect.poll(() => staleLanded, { timeout: 30_000 }).toBe(true);
    expect(committed[1]).not.toBe(committed[2]);

    const post = k.posted(slug);
    await k.submit().click();
    await post;

    // ---- The word holds the SECOND picture ----
    const thumb = page
      .locator('.fc-wcard', { hasText: 'harbour' })
      .locator('img[src^="/flashcard-"]');
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute('src', `/flashcard-images/${fileOf(committed[2])}`);
    // naturalWidth > 0 proves the key serves real bytes, not a 404.
    await expect
      .poll(async () => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    await deleteTopic(page, k, topic);
  });

  test('word picture: a copy that fails leaves no picture, not the previous one', async ({
    page,
  }) => {
    let commits = 0;
    let firstKey = '';
    // The second copy fails outright. A 502 is exactly what the commit route returns when the
    // provider hands back something unstorable, which is common enough on live stock search.
    await page.route('**/vocab-image-commit', async (route) => {
      if (++commits === 1) {
        const res = await route.fetch();
        const body = await res.text();
        firstKey = JSON.parse(body).data.imageKey as string;
        await route.fulfill({ response: res, body });
        return;
      }
      await route.fulfill({ status: 502, body: JSON.stringify({ error: 'commit_failed' }) });
    });

    const { k, topic, slug, strip } = await wordDialogOnFreshTopic(page, 'lantern');

    await strip.locator(TILE).first().click();
    await expect.poll(() => firstKey, { timeout: 60_000 }).not.toBe('');
    await expect(strip.locator(`${TILE}[aria-pressed="true"]`)).toHaveCount(1);

    const fresh = await refreshPicker(page, strip);
    await fresh.click();

    // The failed copy reports itself and drops the selection — so nothing is attached any more.
    await expect(
      strip.getByText('Could not load pictures. The word saves fine without one.'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(strip.locator(`${TILE}[aria-pressed="true"]`)).toHaveCount(0);

    const post = k.posted(slug);
    await k.submit().click();
    await post;

    // ---- The word saves with no picture. It must NOT fall back to the pre-refresh one. ----
    const row = page.locator('.fc-wcard', { hasText: 'lantern' });
    await expect(row).toBeVisible();
    await expect(row.locator('img[src^="/flashcard-images/"]')).toHaveCount(0);

    await deleteTopic(page, k, topic);
  });
});
