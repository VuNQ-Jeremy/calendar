import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Vocabulary CRUD: topics and words. The test env has no ANTHROPIC_API_KEY,
 * so canUseAi=false — the AI generate/enrich paths are not rendered and
 * word-create never triggers enrichment. Everything here is manual entry.
 */

test.describe('CRUD: vocabulary', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/vocabulary');
  });

  test('topic: create, edit, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E topic ${Date.now()}`;
    const card = (n: string) => page.locator('.mochi-card', { hasText: n });

    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(name); // DS.Input — real label association
    let post = k.posted('/vocabulary');
    await k.submit().click(); // "Save"
    await post;
    await expect(card(name)).toBeVisible();
    await expect(card(name)).toContainText('0 words');

    await card(name).getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Topic name').fill(`${name} v2`);
    post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    await expect(card(`${name} v2`)).toBeVisible();

    await card(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(card(`${name} v2`)).toHaveCount(0);
  });

  test('word: create, edit, delete inside a topic', async ({ page }) => {
    const k = ui(page);
    const topic = `E2E word topic ${Date.now()}`;

    // A fresh topic keeps the word list deterministic.
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    // Click the TITLE, not the card. The whole card navigates, but a bare .click() lands on its
    // center — which the staff action buttons can occupy, and those stopPropagation() to open
    // their own dialogs. Targeting the title is immune to the card's internal layout.
    await page.locator('.mochi-card', { hasText: topic }).getByText(topic).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    const topicPath = new URL(page.url()).pathname;

    await page.getByRole('button', { name: 'Add word' }).click();
    await k.textIn('Word').fill('ephemeral');
    await k.textIn('Meaning (Vietnamese)').fill('phù du');
    post = k.posted(topicPath);
    await k.submit().click();
    await post;
    const row = page.locator('.fc-wcard', { hasText: 'ephemeral' });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Edit' }).click();
    await k.textIn('Meaning (Vietnamese)').fill('phù du, chóng tàn');
    post = k.posted(topicPath);
    await k.submit().click();
    await post;
    await expect(row).toContainText('chóng tàn');

    // Word delete confirms in a dialog quirkily titled "Edit word".
    await row.getByRole('button', { name: 'Delete' }).click();
    post = k.posted(topicPath);
    await k.dlg.locator('.mochi-btn.is-danger').click(); // "Delete"
    await post;
    await expect(row).toHaveCount(0);
    await expect(page.getByText('No words yet')).toBeVisible();

    // Cleanup: remove the topic again.
    await page.goto('/vocabulary');
    await page
      .locator('.mochi-card', { hasText: topic })
      .getByRole('button', { name: 'Delete' })
      .click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: topic })).toHaveCount(0);
  });
});
