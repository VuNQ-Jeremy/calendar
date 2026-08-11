import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent, ui } from './crud-helpers';

/**
 * /logs — the admin diagnostics page, and its one section: the review schedule.
 *
 * Read-only, so there is no lifecycle to walk. What is worth asserting is the two things that could
 * silently break: the admin guard (a hidden nav row is not a permission), and the student filter,
 * which is a NAVIGATION rather than local state because the filter lives in the path.
 *
 * The spec creates a throwaway topic and plays one round so there is a scheduled word to find,
 * then deletes the topic — its mastery rows cascade away with it.
 */

test.describe('logs: admin diagnostics', () => {
  crudGuard();

  test('scheduled words: admin-only, filterable by student', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const k = ui(page);
    const topic = `E2E logs topic ${Date.now()}`;

    // ---- Staff (dev@mochi.edu is an Admin): a topic with one word. ----
    await signInStaff(page);
    await page.goto('/vocabulary');
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    // The title, not the card: the card's centre belongs to the staff action buttons.
    await page.locator('.mochi-card', { hasText: topic }).getByText(topic).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    const topicPath = new URL(page.url()).pathname;

    await page.getByRole('button', { name: 'Add word' }).click();
    await k.textIn('Word').fill('ephemeral');
    await k.textIn('Meaning (Vietnamese)').fill('phù du');
    post = k.posted(topicPath);
    await k.submit().click();
    await post;

    // ---- The student plays it once, which puts the word on the ladder. ----
    const studentCtx = await browser.newContext();
    const sp = await studentCtx.newPage();
    const sk = ui(sp);
    await signInStudent(sp);
    await sp.goto(topicPath);
    await sp.getByRole('button', { name: 'Flip cards' }).click();
    post = sk.posted(topicPath);
    await sp.getByRole('button', { name: 'I know it' }).click();
    await post;

    // ---- A student may not open the page at all: the loader 403s, nav row or no nav row. ----
    expect((await sp.request.get('/logs')).status()).toBe(403);
    await expect(sp.locator('.sb a[href="/logs"]')).toHaveCount(0);
    await studentCtx.close();

    // ---- Admin: the row is in the sidebar's admin group and the word is listed. ----
    await page.goto('/logs');
    await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible();
    const section = page.locator('.mochi-card', { hasText: 'Scheduled words' });
    await expect(section).toContainText('ephemeral');
    await expect(section).toContainText(topic);
    // First rung of the ladder, and three days out on the default schedule.
    await expect(section).toContainText('Step 1');

    // ---- Filtering is a navigation: the student ends up in the path. ----
    await section.locator('button.m-select__trigger').click();
    await page.getByRole('option', { name: 'Leo Park', exact: true }).click();
    await page.waitForURL(/\/logs\/.+/);
    await expect(section).toContainText('ephemeral');

    // A different student cannot have this word, so the row must disappear.
    await section.locator('button.m-select__trigger').click();
    await page.getByRole('option', { name: 'Mia Chen', exact: true }).click();
    await expect(section).not.toContainText('ephemeral');

    // And back to everyone.
    await section.locator('button.m-select__trigger').click();
    await page.getByRole('option', { name: 'All students', exact: true }).click();
    await page.waitForURL(/\/logs\/?$/);
    await expect(section).toContainText('ephemeral');

    // ---- Cleanup: the topic goes, and its mastery rows cascade with it. ----
    await page.goto('/vocabulary');
    await page
      .locator('.mochi-card', { hasText: topic })
      .getByRole('button', { name: 'Delete' })
      .click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;

    await page.goto('/logs');
    await expect(page.locator('.mochi-card', { hasText: 'Scheduled words' })).not.toContainText(
      'ephemeral',
    );
  });
});
