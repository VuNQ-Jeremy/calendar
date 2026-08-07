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
});
