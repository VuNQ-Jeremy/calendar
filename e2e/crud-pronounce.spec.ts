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
    // Raw 88 + the round5 curve → the big number shows 90% while the drawer keeps 88.
    accuracy: 88,
    fluency: 90,
    completeness: 100,
    pronScore: 91,
    recognized: 'ephemeral',
    correct: true,
    noSpeech: false,
    curve: 'round5',
    // Mixed tiers on purpose: the breakdown must render every phoneme, not just the bad ones.
    words: [
      {
        word: 'ephemeral',
        errorType: 'None',
        accuracy: 85,
        phonemes: [
          { ipa: 'ɪ', accuracy: 95 },
          { ipa: 'f', accuracy: 40 },
          { ipa: 'ɛ', accuracy: 92 },
          { ipa: 'm', accuracy: 70 },
          { ipa: 'ə', accuracy: 88 },
          { ipa: 'r', accuracy: 81 },
          { ipa: 'ə', accuracy: 90 },
          { ipa: 'l', accuracy: 85 },
        ],
        // Syllable groups as the server maps them: phonemes already nested per syllable.
        syllables: [
          {
            ipa: 'ɪ',
            accuracy: 95,
            phonemes: [{ ipa: 'ɪ', accuracy: 95 }],
          },
          {
            ipa: 'fɛ',
            accuracy: 66,
            phonemes: [
              { ipa: 'f', accuracy: 40 },
              { ipa: 'ɛ', accuracy: 92 },
            ],
          },
          {
            ipa: 'mə',
            accuracy: 79,
            phonemes: [
              { ipa: 'm', accuracy: 70 },
              { ipa: 'ə', accuracy: 88 },
            ],
          },
          {
            ipa: 'rəl',
            accuracy: 86,
            phonemes: [
              { ipa: 'r', accuracy: 81 },
              { ipa: 'ə', accuracy: 90 },
              { ipa: 'l', accuracy: 85 },
            ],
          },
        ],
      },
    ],
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

  /**
   * Record ~a second of fake-mic tone and stop. Stopping submits on its own — the caller's
   * /speech-assess route must already be armed before this runs.
   */
  async function recordClip(page: Page) {
    await page.getByRole('button', { name: 'Tap the mic and say the word' }).click();
    const stop = page.getByRole('button', { name: 'Listening… tap to stop and score' });
    await expect(stop).toBeVisible();
    await page.waitForTimeout(800); // give the fake device time to fill some buffers
    await stop.click();
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

    // Stopping scores it — no second tap. The canned score renders, then Next finishes the
    // one-word round; the result posts as the end screen mounts, so arm the wait before clicking.
    await recordClip(page);
    // The forgiveness curve echoed in the response (round5) lifts the displayed number:
    // raw accuracy 88 renders as 90%.
    await expect(page.getByText('90%', { exact: true })).toBeVisible();
    // The scored screen stays simple — syllable pills carry colours only (getByText matches the
    // concatenated phoneme spans), no numbers.
    await expect(page.getByText('fɛ', { exact: true })).toBeVisible();
    await expect(page.getByText('rəl', { exact: true })).toBeVisible();

    // The numbers live in the details drawer behind the chart icon — RAW, not curved: clip
    // scores, per-syllable scores and per-phoneme scores.
    await page.getByRole('button', { name: 'Detailed breakdown' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Fluency')).toBeVisible();
    await expect(drawer.getByText('88', { exact: true })).toBeVisible(); // raw accuracy, not 90
    await expect(drawer.getByText('/fɛ/', { exact: true })).toBeVisible();
    await expect(drawer.getByText('66', { exact: true })).toBeVisible(); // that syllable's score
    await expect(drawer.getByText('We heard: “ephemeral”')).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
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

    // The busy copy shows, then the single auto-retry (2s) succeeds on the stub's second call.
    await expect(page.getByText(/scoring service is busy/)).toBeVisible();
    await expect(page.getByText('90%', { exact: true })).toBeVisible({ timeout: 10_000 });
    const post = k.posted(path);
    await page.getByRole('button', { name: 'Next' }).click();
    await post;
    await expect(page.getByText('Round complete!')).toBeVisible();

    await page.getByRole('button', { name: 'Exit' }).first().click();
    await deleteTopic(page, topic);
  });
});
