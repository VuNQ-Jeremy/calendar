import { test, expect } from '@playwright/test';

/**
 * The generated-topic review list finds pictures for every word on its own, and offers each row a
 * strip of alternatives with one already chosen.
 *
 * This is the one image path that cannot run on calendar-test: word generation needs
 * ANTHROPIC_API_KEY, which that environment deliberately does not have (the AI buttons are hidden
 * there). So it runs wherever the suite is pointed — production included — and is written to be
 * safe there: it opens the modal, generates, checks the pictures arrived, and **closes without
 * saving**. No topic and no word is ever written.
 *
 * It does leave a few unreferenced objects in R2, since a candidate is fetched per word. That is
 * the same trail an abandoned review leaves for a teacher, and the daily job collects it once the
 * objects are over a day old (pruneImages in server/services/vocab-images.ts).
 */

const EMAIL = process.env.MOCHI_EMAIL;
const PASSWORD = process.env.MOCHI_PASSWORD;

test.describe('vocabulary: generated topics arrive with pictures', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set MOCHI_EMAIL and MOCHI_PASSWORD to run this');

  test('review list auto-attaches a candidate picture per word', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL!);
    await page.fill('input[name="password"]', PASSWORD!);
    await page.click('form[action="/login"] button[type="submit"]');
    await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });

    await page.goto('/vocabulary');
    const generate = page.getByRole('button', { name: 'Generate topic with AI' });
    // Hidden when ANTHROPIC_API_KEY is unset (canUseAi=false) — nothing to test in that case.
    test.skip(!(await generate.count()), 'AI generation is disabled in this environment');
    await generate.click();

    const dlg = page.locator('.m-dialog[role="dialog"]');
    await expect(dlg).toBeVisible();

    // Small count: this spends real Claude tokens and real image lookups on every run.
    const field = (label: string) =>
      dlg.locator(`.mochi-field:has(> label.mochi-field__label:text-is("${label}"))`);
    await field('Topic name').locator('input.mochi-input').fill('Kitchen objects');
    await field('Number of words').locator('input.mochi-input').fill('4');

    await dlg.locator('.m-dialog__foot .mochi-btn.is-primary').click();

    // Generation is a Claude call behind a Durable Object hop; give it room.
    const rows = dlg.locator('.lrow');
    await expect(rows.first()).toBeVisible({ timeout: 90_000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Every row gets a picture button; at least one should resolve to a real thumbnail once the
    // background lookups land. Asserting "at least one" rather than "all": these are live
    // third-party searches and an odd word legitimately finds nothing.
    await expect
      .poll(async () => rows.locator('img').count(), { timeout: 60_000 })
      .toBeGreaterThan(0);

    const firstThumb = rows.locator('img').first();
    await expect
      .poll(async () => firstThumb.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);

    // Each row offers a strip of alternatives with the auto-attached one already outlined, so the
    // teacher can change a picture in one tap without leaving the list.
    const firstRow = rows.first();
    const tiles = firstRow.locator('button:has(> img)');
    expect(await tiles.count()).toBeGreaterThan(1);
    await expect(firstRow.locator('button[aria-pressed="true"]:has(> img)')).toHaveCount(1);

    // Picking a different tile moves the outline, and nothing is committed until save.
    await tiles.nth(1).click();
    await expect(tiles.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(firstRow.locator('button[aria-pressed="true"]:has(> img)')).toHaveCount(1);

    // Tapping the outlined tile again clears it — a word can be saved with no picture.
    await tiles.nth(1).click();
    await expect(firstRow.locator('button[aria-pressed="true"]:has(> img)')).toHaveCount(0);

    // Leave without saving — nothing is written, which is what makes this safe on production.
    // Escape, not the footer's "Cancel": in the review step that button steps back to the setup
    // form rather than closing, so it would leave the dialog open.
    await page.keyboard.press('Escape');
    await expect(page.locator('.m-dialog[role="dialog"]')).toHaveCount(0);
  });
});
