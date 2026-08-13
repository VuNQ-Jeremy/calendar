import { test, expect, type Page } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * The pronounce game ("Say it"): record a word, score it, land under Results.
 *
 * Two things are faked, deliberately:
 *  - The microphone — playwright.config.ts launches the browser with Chromium's fake media
 *    device, so getUserMedia yields a synthetic tone and the REAL recorder code (Web Audio
 *    capture → WAV assembly) runs unmodified.
 *  - The scoring route — calendar-test carries no AZURE_SPEECH_KEY on purpose, and the suite
 *    must not depend on (or bill) Azure. page.route() answers /speech-assess with canned
 *    scores, which still exercises the full submit → score → next → record-result flow.
 */

const SCORED = {
  data: {
    accuracy: 85,
    fluency: 90,
    completeness: 100,
    pronScore: 88,
    recognized: 'ephemeral',
    correct: true,
    noSpeech: false,
  },
};

test.describe('CRUD: pronounce game round', () => {
  crudGuard();

  async function createTopicWithWord(page: Page, name: string): Promise<string> {
    const k = ui(page);
    await page.goto('/vocabulary');
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(name);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    // The title, not the card: a bare .click() hits the card's center, where the staff action
    // buttons live — and they stopPropagation() to open dialogs instead of navigating.
    await page.locator('.mochi-card', { hasText: name }).getByText(name).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    const path = new URL(page.url()).pathname;

    // One word is all the pronounce mode needs (MIN_WORDS.pronounce = 1).
    await page.getByRole('button', { name: 'Add word' }).click();
    await k.textIn('Word').fill('ephemeral');
    await k.textIn('Meaning (Vietnamese)').fill('phù du');
    post = k.posted(path);
    await k.submit().click();
    await post;
    await expect(page.locator('.fc-wcard', { hasText: 'ephemeral' })).toBeVisible();
    return path;
  }

  async function deleteTopic(page: Page, name: string) {
    const k = ui(page);
    await page.goto('/vocabulary');
    await page
      .locator('.mochi-card', { hasText: name })
      .getByRole('button', { name: 'Delete' })
      .click();
    const post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: name })).toHaveCount(0);
  }

  /** Record ~a second of fake-mic tone and stop. Leaves the game in the "recorded" state. */
  async function recordClip(page: Page) {
    await page.getByRole('button', { name: 'Tap the mic and say the word' }).click();
    const stop = page.getByRole('button', { name: 'Listening… tap to stop' });
    await expect(stop).toBeVisible();
    await page.waitForTimeout(800); // give the fake device time to fill some buffers
    await stop.click();
    await expect(page.getByRole('button', { name: 'Check my pronunciation' })).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
  });

  test('record → score → next lands the round under Results', async ({ page }) => {
    const k = ui(page);
    const topic = `E2E pron topic ${Date.now()}`;
    const path = await createTopicWithWord(page, topic);

    await page.route('**/speech-assess', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SCORED),
      }),
    );

    await page.getByRole('button', { name: 'Say it' }).click();
    await expect(page.getByText('ephemeral').first()).toBeVisible();

    await recordClip(page);
    await page.getByRole('button', { name: 'Check my pronunciation' }).click();

    // The canned score renders, then Next finishes the one-word round; the result posts as
    // the end screen mounts, so arm the wait before clicking.
    await expect(page.getByText('85', { exact: true })).toBeVisible();
    await expect(page.getByText('We heard: “ephemeral”')).toBeVisible();
    const post = k.posted(path);
    await page.getByRole('button', { name: 'Next' }).click();
    await post;
    await expect(page.getByText('Round complete!')).toBeVisible();
    await expect(page.getByText('Score: 1/1')).toBeVisible();
    await page.getByRole('button', { name: 'Exit' }).first().click();

    await page.getByRole('tab', { name: 'Results' }).click();
    const play = page.locator('.lrow', { hasText: 'Say it' });
    await expect(play).toBeVisible();
    await expect(play).toContainText('1/1');

    await deleteTopic(page, topic);
  });

  test('429 shows the busy notice and the automatic retry completes the round', async ({
    page,
  }) => {
    const k = ui(page);
    const topic = `E2E pron busy ${Date.now()}`;
    const path = await createTopicWithWord(page, topic);

    // First call: the free tier's "one student at a time" collision. Second: scored.
    let calls = 0;
    await page.route('**/speech-assess', (r) => {
      calls++;
      if (calls === 1) {
        return r.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'busy' }),
        });
      }
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SCORED),
      });
    });

    await page.getByRole('button', { name: 'Say it' }).click();
    await recordClip(page);
    await page.getByRole('button', { name: 'Check my pronunciation' }).click();

    // The busy copy shows, then the single auto-retry (2s) succeeds on the stub's second call.
    await expect(page.getByText(/scoring service is busy/)).toBeVisible();
    await expect(page.getByText('85', { exact: true })).toBeVisible({ timeout: 10_000 });
    const post = k.posted(path);
    await page.getByRole('button', { name: 'Next' }).click();
    await post;
    await expect(page.getByText('Round complete!')).toBeVisible();

    await page.getByRole('button', { name: 'Exit' }).first().click();
    await deleteTopic(page, topic);
  });
});
