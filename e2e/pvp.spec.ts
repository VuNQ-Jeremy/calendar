import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent, ui } from './crud-helpers';

/**
 * PvP vocab battles (F33/F34): a join-by-code room race between staff and a student, then a
 * tabletop face-off duel.
 *
 * The room battle's reveal pause is a real 4-second `GameRoom` alarm (shared/logic/pvp.ts's
 * PVP_REVEAL_MS) — this spec waits it out for real rather than trying to fast-forward it, the
 * way `test-worker/game-room.test.js` does with `runDurableObjectAlarm`. With a 6-word topic
 * (`buildQuizQuestions` caps a round at the deck size) that's ~6 x 4s of real waiting, hence the
 * raised test timeout.
 */

test.describe('CRUD: PvP vocab battles', () => {
  crudGuard();

  test('room battle: host creates, a student joins by code, both play to the podium, the ladder updates', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const k = ui(page);
    const topic = `E2E PvP ${Date.now()}`;
    const words = ['whisker', 'burrow', 'nest', 'antler', 'talon', 'gill'];

    await signInStaff(page);
    await page.goto('/vocabulary');

    // ---- A throwaway topic with 6 words — enough for MIN_WORDS.quiz and a short round. ----
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    await page.locator('.mochi-card', { hasText: topic }).getByText(topic).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    const topicPath = new URL(page.url()).pathname;

    for (const w of words) {
      await page.getByRole('button', { name: 'Add word' }).click();
      await k.textIn('Word').fill(w);
      await k.textIn('Meaning (Vietnamese)').fill(`nghĩa ${w}`);
      post = k.posted(topicPath);
      await k.submit().click();
      await post;
    }

    // ---- Host opens the Battle dialog and creates a room. ----
    await page.getByRole('button', { name: 'Battle' }).click();
    await page.getByRole('button', { name: 'Room with friends' }).click();
    const roomPost = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname === '/game-rooms.data' &&
        r.ok(),
    );
    await page.getByRole('button', { name: 'Create room' }).click();
    await roomPost;
    await page.waitForURL(/\/battle\/[A-Z0-9]{4}$/);
    const code = page.url().split('/').pop()!;

    // ---- A student joins by typing the code on /vocabulary. ----
    const studentCtx = await browser.newContext();
    const sp = await studentCtx.newPage();
    await signInStudent(sp);
    await sp.goto('/vocabulary');
    await sp.getByPlaceholder('CODE').fill(code);
    await sp.getByRole('button', { name: 'Join' }).click();
    await sp.waitForURL(`/battle/${code}`);

    // Both land in the lobby; the host sees Start, the student waits.
    await expect(page.getByRole('button', { name: 'Start' })).toBeEnabled();
    await expect(sp.getByText('Waiting for the host to start…')).toBeVisible();

    await page.getByRole('button', { name: 'Start' }).click();

    // ---- Play every question: tap any option on both sides, wait out the reveal pause. ----
    for (let i = 0; i < words.length; i++) {
      await expect(page.locator('.mochi-btn').first()).toBeVisible();
      await page.locator('.mochi-btn').first().click();
      await sp.locator('.mochi-btn').first().click();
      // The reveal broadcasts once both have answered; give the 4s alarm time to advance.
      await page.waitForTimeout(4500);
    }

    // ---- Both reach the podium. ----
    await expect(page.getByText('Battle over!')).toBeVisible({ timeout: 15_000 });
    await expect(sp.getByText('Battle over!')).toBeVisible({ timeout: 15_000 });
    await studentCtx.close();

    // ---- The student's play landed on this month's ladder. ----
    await page.goto('/vocabulary');
    await expect(page.getByText('Leo Park')).toBeVisible();

    // ---- Cleanup. ----
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

  test('face-off: a tabletop 1v1 duel locks a wrong side and records the winner', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const k = ui(page);
    const topic = `E2E Faceoff ${Date.now()}`;
    // word -> its Vietnamese meaning, known up front so the spec can always tap the right
    // option for player 1 (the correct answer is never exposed to a real player ahead of the
    // reveal, so a spec has to know it the same way the person authoring the words does).
    const wordMeaning: Record<string, string> = {
      whisker: 'nghĩa whisker',
      burrow: 'nghĩa burrow',
      nest: 'nghĩa nest',
      antler: 'nghĩa antler',
      talon: 'nghĩa talon',
      gill: 'nghĩa gill',
    };

    await signInStaff(page);
    await page.goto('/vocabulary');
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    await page.locator('.mochi-card', { hasText: topic }).getByText(topic).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    const topicPath = new URL(page.url()).pathname;

    for (const [w, m] of Object.entries(wordMeaning)) {
      await page.getByRole('button', { name: 'Add word' }).click();
      await k.textIn('Word').fill(w);
      await k.textIn('Meaning (Vietnamese)').fill(m);
      post = k.posted(topicPath);
      await k.submit().click();
      await post;
    }

    await page.getByRole('button', { name: 'Battle' }).click();
    await page.getByRole('button', { name: '1v1 on this device' }).click();
    await page.waitForURL(new RegExp(`/faceoff/.+`));

    // Pick real students so the win is recorded — Leo Park (the seeded login student) vs. Mia
    // Chen, both from seed.sql; no new roster row needed for this spec.
    await k.on(page).pickSel('Player 1', 'Leo Park');
    await k.on(page).pickSel('Player 2', 'Mia Chen');
    await page.getByRole('button', { name: 'Start' }).click();

    // ---- A deliberate wrong tap on player 1's side locks only that half. ----
    const p1 = page.locator('[data-side="1"]');
    const p2 = page.locator('[data-side="2"]');
    // Both players were picked, so each half renders exactly two <span>s up top: the player's
    // name, then the word — in that order (see FaceoffHalf in src/flashcards/faceoff.tsx).
    const wordShownIn = async (half: typeof p1) =>
      (await half.locator('span').nth(1).textContent())?.trim() ?? '';

    const firstWord = await wordShownIn(p1);
    const wrongOption = Object.values(wordMeaning).find((m) => m !== wordMeaning[firstWord])!;
    await p1.getByRole('button', { name: wrongOption }).click();
    await expect(p1.getByText('Wrong — wait for the next question…')).toBeVisible();
    // The correct option on THIS side no longer responds until the question advances.
    await expect(p1.getByRole('button', { name: wordMeaning[firstWord] })).toBeDisabled();

    // Player 2 answering (correctly or not) advances the question past the lock.
    const p2Word = await wordShownIn(p2);
    await p2.getByRole('button', { name: wordMeaning[p2Word] }).click();

    // ---- Player 1 now answers every remaining question correctly; player 2 never taps again,
    // so player 1 reaches 5 points alone and wins. ----
    for (let i = 0; i < 6; i++) {
      const finished = await page
        .getByText('wins!')
        .isVisible()
        .catch(() => false);
      if (finished) break;
      const word = await wordShownIn(p1);
      const answer = wordMeaning[word];
      if (!answer) break;
      await p1.getByRole('button', { name: answer }).click();
    }

    await expect(page.getByText('Leo Park wins!')).toBeVisible({ timeout: 10_000 });

    // ---- Recorded on the ladder (staff-gated faceoff-result posted to /game-rooms). ----
    await page.goto('/vocabulary');
    await expect(page.getByText('Leo Park')).toBeVisible();

    // ---- Cleanup. ----
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
