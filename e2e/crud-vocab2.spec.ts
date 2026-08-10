import { test, expect, type Page } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Remaining vocabulary intents: words-import (bulk paste) and record-result
 * (a completed Flip cards round). Staff plays are recorded in Recent plays —
 * flagged with a staff badge, excluded from the leaderboard.
 */

test.describe('CRUD: vocabulary imports and game results', () => {
  crudGuard();

  async function createTopic(page: Page, name: string): Promise<string> {
    const k = ui(page);
    await page.goto('/vocabulary');
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(name);
    const post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    // The title, not the card: a bare .click() hits the card's center, where the staff action
    // buttons live — and they stopPropagation() to open dialogs instead of navigating.
    await page.locator('.mochi-card', { hasText: name }).getByText(name).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    return new URL(page.url()).pathname;
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

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
  });

  test('words-import: paste a list, review, import', async ({ page }) => {
    const k = ui(page);
    const topic = `E2E import topic ${Date.now()}`;
    const path = await createTopic(page, topic);

    // With no ANTHROPIC_API_KEY the modal's first step is a plain "Review".
    await page.getByRole('button', { name: 'Import' }).click();
    const dlg = k.dlgOf('Import words');
    await dlg.locator('textarea').fill('serendipity - sự tình cờ may mắn\nresilience - sự kiên cường');
    await dlg.getByRole('button', { name: 'Review' }).click();
    const post = k.posted(path);
    await dlg.getByRole('button', { name: /Import 2 words/ }).click();
    await post;
    await expect(page.locator('.lrow', { hasText: 'serendipity' })).toBeVisible();
    await expect(page.locator('.lrow', { hasText: 'resilience' })).toBeVisible();

    await deleteTopic(page, topic);
  });

  test('record-result: a finished flip round shows under Results', async ({ page }) => {
    const k = ui(page);
    const topic = `E2E play topic ${Date.now()}`;
    const path = await createTopic(page, topic);

    // One word is enough for Flip cards (quiz needs 4, matching 3).
    await page.getByRole('button', { name: 'Add word' }).click();
    await k.textIn('Word').fill('ephemeral');
    await k.textIn('Meaning (Vietnamese)').fill('phù du');
    let post = k.posted(path);
    await k.submit().click();
    await post;
    await expect(page.locator('.lrow', { hasText: 'ephemeral' })).toBeVisible();

    // Play: mark the single card known. The result posts as the end screen
    // mounts (not on Exit), so arm the wait before the final click.
    await page.getByRole('button', { name: 'Flip cards' }).click();
    post = k.posted(path);
    await page.getByRole('button', { name: 'I know it' }).click();
    await post;
    await expect(page.getByText('Round complete!')).toBeVisible();
    // Two Exit buttons exist (overlay header + end screen) — either closes.
    await page.getByRole('button', { name: 'Exit' }).first().click();

    await page.getByRole('tab', { name: 'Results' }).click();
    const play = page.locator('.lrow', { hasText: 'Flip cards' });
    await expect(play).toBeVisible();
    await expect(play).toContainText('1/1');

    await deleteTopic(page, topic);
  });

  test('type + scramble rounds grade and land under Results; fill launches', async ({ page }) => {
    const k = ui(page);
    const topic = `E2E spell topic ${Date.now()}`;
    const path = await createTopic(page, topic);

    await page.getByRole('button', { name: 'Add word' }).click();
    await k.textIn('Word').fill('ephemeral');
    await k.textIn('Meaning (Vietnamese)').fill('phù du');
    let post = k.posted(path);
    await k.submit().click();
    await post;
    await expect(page.locator('.lrow', { hasText: 'ephemeral' })).toBeVisible();

    // Type it: the meaning prompts, the word is the answer — fully deterministic. The result
    // posts as the end screen mounts, so arm the wait before the graded submit.
    await page.getByRole('button', { name: 'Type it' }).click();
    await expect(page.getByText('phù du')).toBeVisible();
    post = k.posted(path);
    await page.getByPlaceholder('Type here…').fill('ephemeral');
    await page.getByRole('button', { name: 'Check' }).click();
    await post;
    await expect(page.getByText('Round complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Exit' }).first().click();

    // Unscramble: tiles are shuffled, but each carries its letter in data-tile, and a used tile
    // disables — so clicking the word's letters in spelling order wins whatever the shuffle was.
    await page.getByRole('button', { name: 'Unscramble' }).click();
    const bank = page.getByTestId('scramble-bank');
    await expect(bank).toBeVisible();
    post = k.posted(path);
    for (const ch of 'ephemeral') {
      await bank.locator(`button[data-tile="${ch}"]:not([disabled])`).first().click();
    }
    await post;
    await expect(page.getByText('Round complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Exit' }).first().click();

    // Fill letters: which letters hide is random, so this is a launch smoke — board and bank
    // render, exit works. Grading is covered by the two deterministic modes above and the unit
    // tests on maskWord.
    await page.getByRole('button', { name: 'Fill letters' }).click();
    await expect(page.getByTestId('fill-slots')).toBeVisible();
    await expect(page.getByTestId('fill-bank')).toBeVisible();
    await page.getByRole('button', { name: 'Exit' }).first().click();

    // Picture quiz stays disabled until a word carries a picture.
    await expect(page.getByRole('button', { name: 'Picture quiz' })).toBeDisabled();

    await page.getByRole('tab', { name: 'Results' }).click();
    const typed = page.locator('.lrow', { hasText: 'Type it' });
    await expect(typed).toBeVisible();
    await expect(typed).toContainText('1/1');
    const scrambled = page.locator('.lrow', { hasText: 'Unscramble' });
    await expect(scrambled).toBeVisible();
    await expect(scrambled).toContainText('1/1');

    await deleteTopic(page, topic);
  });
});
