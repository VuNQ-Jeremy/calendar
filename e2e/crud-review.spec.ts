import { test, expect } from '@playwright/test';
import { crudGuard, openConfigEntry, signInStaff, signInStudent, ui } from './crud-helpers';

/**
 * Ôn tập: a word studied today comes back, is reviewed, and stops being due.
 *
 * The whole feature is a clock, so the spec moves the clock rather than waiting: the admin sets the
 * first interval to **0 days**, which means "due again today". That is the reason the bound allows
 * zero at all (shared/logic/review.ts) — without it a full cycle would take three real days.
 *
 * The ladder is school-wide, so the spec puts it back at the end. `settings` rows are NOT swept by
 * scripts/test-accounts.sql: a leaked 0 would make every word in the test database due forever and
 * quietly wreck the other vocabulary specs.
 */

const LADDER = [
  'First review (days)',
  'Second review (days)',
  'Third review (days)',
  'Fourth review (days)',
  'Every review after (days)',
];
const DEFAULTS = ['3', '5', '7', '14', '30'];
const SAME_DAY = ['0', '5', '7', '14', '30'];

test.describe('CRUD: spaced-repetition review', () => {
  crudGuard();

  test('review: a played word falls due, is reviewed, and clears', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const k = ui(page);
    const topic = `E2E review topic ${Date.now()}`;

    await signInStaff(page);

    // ---- Admin: make the first rung same-day, so one round is immediately reviewable. ----
    await page.goto('/config');
    let card = await openConfigEntry(page, 'Review schedule');
    const textIn = (label: string) => k.on(card).textIn(label);
    const save = () => card.getByRole('button', { name: 'Save' });

    // Save is disabled until something actually changes.
    await expect(save()).toBeDisabled();
    // A ladder that shortens as it climbs is refused by the form, as by the schema.
    await textIn(LADDER[1]).fill('1');
    await expect(save()).toBeDisabled();

    for (const [i, label] of LADDER.entries()) await textIn(label).fill(SAME_DAY[i]);
    let post = k.posted('/config');
    await save().click();
    await post;

    await page.reload();
    card = await openConfigEntry(page, 'Review schedule');
    await expect(textIn(LADDER[0])).toHaveValue('0');

    // ---- Staff: a throwaway topic with one word. 1/1 through Flip is the deterministic round. ----
    await page.goto('/vocabulary');
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    post = k.posted('/vocabulary');
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

    // ---- Student: play it once. That schedules the word, due today. ----
    const studentCtx = await browser.newContext();
    const sp = await studentCtx.newPage();
    const sk = ui(sp);
    await signInStudent(sp);
    await sp.goto(topicPath);
    await sp.getByRole('button', { name: 'Flip cards' }).click();
    post = sk.posted(topicPath);
    await sp.getByRole('button', { name: 'I know it' }).click();
    await post;
    await sp.getByRole('button', { name: 'Exit' }).first().click();

    // ---- The due card names the topic and counts its word. ----
    await sp.goto('/vocabulary');
    const due = sp.locator('.mochi-card', { hasText: 'Review today' });
    await expect(due).toContainText(`1 words in "${topic}" are due today`);
    // And the sidebar badge agrees — it counts the same rows against the same ICT day.
    await expect(sp.locator('.sb a[href="/vocabulary"]')).toContainText('1');

    // ---- Review it. The banner says the deck is the due words, not the whole topic. ----
    await due.getByRole('button', { name: 'Review now' }).click();
    await sp.waitForURL(/\?review=1/);
    await expect(sp.getByText('Reviewing 1 words that are due')).toBeVisible();

    await sp.getByRole('button', { name: 'Flip cards' }).click();
    post = sk.posted(topicPath);
    await sp.getByRole('button', { name: 'I know it' }).click();
    await post;
    await sp.getByRole('button', { name: 'Exit' }).first().click();

    // A correct answer at the due date climbs to the second rung — 5 days out — so the backlog is
    // empty and the card is gone entirely (it renders only when something is due).
    await expect(sp.getByText('Reviewing 1 words that are due')).toHaveCount(0);
    await expect(sp.getByText("You're all caught up on this topic today")).toBeVisible();

    await sp.goto('/vocabulary');
    await expect(sp.locator('.mochi-card', { hasText: 'Review today' })).toHaveCount(0);

    // ---- Cleanup: the topic goes, taking its mastery rows with it (FK cascade). ----
    await studentCtx.close();
    await page.goto('/vocabulary');
    await page
      .locator('.mochi-card', { hasText: topic })
      .getByRole('button', { name: 'Delete' })
      .click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: topic })).toHaveCount(0);

    // ---- Cleanup: put the school's ladder back. ----
    await page.goto('/config');
    card = await openConfigEntry(page, 'Review schedule');
    for (const [i, label] of LADDER.entries()) await textIn(label).fill(DEFAULTS[i]);
    post = k.posted('/config');
    await save().click();
    await post;

    await page.reload();
    card = await openConfigEntry(page, 'Review schedule');
    for (const [i, label] of LADDER.entries()) {
      await expect(textIn(label)).toHaveValue(DEFAULTS[i]);
    }
  });
});
