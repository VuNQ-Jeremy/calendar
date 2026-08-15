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

    // ---- A student may not open the page at all, nav row or no nav row. ----
    // requireAdmin (server/services/auth.ts) is requireStaff + an Admin check, and requireStaff
    // REDIRECTS a student to /vocabulary before the 403 branch is ever reached — only non-Admin
    // staff see a bare 403. request.get follows redirects, so asserting 403 here read the landing
    // page's 200. Pin maxRedirects: 0 and assert the redirect itself, which is the real denial.
    const denied = await sp.request.get('/logs', { maxRedirects: 0 });
    expect(denied.status()).toBe(302);
    expect(denied.headers()['location']).toBe('/vocabulary');
    await expect(sp.locator('.sb a[href="/logs"]')).toHaveCount(0);
    await studentCtx.close();

    // ---- Admin: the row is in the sidebar's admin group and the word is listed. ----
    await page.goto('/logs');
    await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible();
    // The tab strip sits above the cards; the Notifications tab has its own spec.
    await expect(page.getByRole('tab', { name: 'Review schedule' })).toBeVisible();
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

  test('usage tab: the Azure speech gauge renders, at zero, on a fresh reset', async ({ page }) => {
    await signInStaff(page);
    await page.goto('/logs');
    await page.getByRole('tab', { name: 'Usage' }).click();
    await page.waitForURL(/\/logs\/usage$/);

    // calendar-test carries no Azure key and the pronounce spec stubs /speech-assess, so the
    // counter is zero — the card and its quota gauge must render anyway.
    const card = page.locator('.mochi-card', { hasText: 'Pronunciation scoring (Azure Speech)' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('0 clips · 0.0 min of audio');
    await expect(card).toContainText('of the 5-hour free month used');

    // The Anthropic card renders too (also zero — the test env never reaches the real API),
    // with its cost estimate line.
    const ai = page.locator('.mochi-card', { hasText: 'AI generation (Claude API)' });
    await expect(ai).toBeVisible();
    await expect(ai).toContainText('0 calls · 0 in / 0 out tokens · ≈ $0.00');
  });
});
