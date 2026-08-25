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

    // ---- The setup step now offers two games; Duel is pre-selected by default (see
    // faceoff.tsx's `useState<FaceoffMode>('duel')`) and the player pickers below render
    // unconditionally regardless of mode, so tapping this row is not strictly required to
    // reach them — but tap it anyway so the spec exercises the real control Task 1 added
    // instead of coasting on the default. ----
    await page.getByRole('button', { name: 'Duel — first to 5' }).click();

    // Pick real students so the win is recorded — Leo Park (the seeded login student) vs. Mia
    // Chen, both from seed.sql; no new roster row needed for this spec.
    await k.on(page).pickSel('Player 1', 'Leo Park');
    await k.on(page).pickSel('Player 2', 'Mia Chen');
    await page.getByRole('button', { name: 'Start' }).click();

    // ---- A deliberate wrong tap on player 1's side locks only that half. ----
    const p1 = page.locator('[data-side="1"]');
    const p2 = page.locator('[data-side="2"]');

    // ---- Pin the rotation so Task 1's fix cannot silently regress. Upright for the player at
    // that edge: the left half's letter tops must point RIGHT (+x), which is rotate(90deg) =
    // matrix(0, 1, -1, 0, …); the right half is the mirror. A screenshot would not have caught
    // the bug that shipped here, and review didn't either — this is the only automated guard. ----
    const rotationOf = (side: 1 | 2) =>
      page.locator(`[data-side="${side}"] > div`).evaluate((el) => getComputedStyle(el).transform);
    expect(await rotationOf(1)).toContain('matrix(0, 1, -1, 0');
    expect(await rotationOf(2)).toContain('matrix(0, -1, 1, 0');

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

  test('face-off: race mode locks only the tapper, and the opponent keeps scoring through it', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const k = ui(page);
    const topic = `E2E Faceoff Race ${Date.now()}`;
    // Ten distinct words == RACE_QUESTION_COUNTS[0] (10 — the round size this spec picks), so
    // buildQuizQuestions(words, 10) returns every word and player 1 can be driven through all
    // ten questions deterministically (shared/logic/pvp.ts, faceoff.tsx's `start`).
    const wordMeaning: Record<string, string> = {
      whisker: 'nghĩa whisker',
      burrow: 'nghĩa burrow',
      nest: 'nghĩa nest',
      antler: 'nghĩa antler',
      talon: 'nghĩa talon',
      gill: 'nghĩa gill',
      beak: 'nghĩa beak',
      fang: 'nghĩa fang',
      shell: 'nghĩa shell',
      scale: 'nghĩa scale',
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

    // ---- Switch to Race, and pick the 10-question round and the shortest (60s) duration. ----
    await page.getByRole('button', { name: 'Race — first to finish' }).click();
    await page
      .locator('.m-row', { hasText: 'Questions' })
      .getByRole('button', { name: '10', exact: true })
      .click();
    await page
      .locator('.m-row', { hasText: 'Time limit' })
      .getByRole('button', { name: '60s', exact: true })
      .click();
    await k.on(page).pickSel('Player 1', 'Leo Park');
    await k.on(page).pickSel('Player 2', 'Mia Chen');
    await page.getByRole('button', { name: 'Start' }).click();

    const p1 = page.locator('[data-side="1"]');
    const p2 = page.locator('[data-side="2"]');
    const wordShownIn = async (half: typeof p1) =>
      (await half.locator('span').nth(1).textContent())?.trim() ?? '';

    // ---- A wrong tap on player 1 costs only that side — read the options actually rendered
    // for this question rather than any word's meaning, since the 3 distractors are a random
    // sample of the other 9 and need not include a given word's meaning. ----
    const firstWord = await wordShownIn(p1);
    const p1Options = await p1.locator('.mochi-btn').allTextContents();
    const wrongOption = p1Options.find((o) => o !== wordMeaning[firstWord])!;
    await p1.getByRole('button', { name: wrongOption }).click();
    await expect(p1.getByText('Wrong — try again in a moment…')).toBeVisible();
    await expect(p1.getByRole('button', { name: wordMeaning[firstWord] })).toBeDisabled();

    // ---- While player 1 is still cooling down, player 2 answers correctly and advances to
    // the next question — the cooldown is self-only (RACE_WRONG_PENALTY_MS in
    // shared/logic/pvp.ts), so the opponent must be unaffected, not merely unblocked in theory. ----
    const p2Word = await wordShownIn(p2);
    await p2.getByRole('button', { name: wordMeaning[p2Word] }).click();
    const p2WordAfter = await wordShownIn(p2);
    expect(p2WordAfter).not.toBe(p2Word);

    // ---- Player 2 never taps again; player 1 waits out its own cooldown (toBeEnabled polls
    // for that) and answers every one of the 10 questions correctly, winning alone. ----
    for (let i = 0; i < 10; i++) {
      const finished = await page
        .getByText('wins!')
        .isVisible()
        .catch(() => false);
      if (finished) break;
      const word = await wordShownIn(p1);
      const answer = wordMeaning[word];
      if (!answer) break;
      const btn = p1.getByRole('button', { name: answer });
      await expect(btn).toBeEnabled({ timeout: 3_000 });
      await btn.click();
    }

    await expect(page.getByText('Leo Park wins!')).toBeVisible({ timeout: 10_000 });

    // ---- Recorded on the ladder (staff-gated faceoff-result posted to /game-rooms). Scoped to
    // the ladder card itself (see `PvpBattleCard` in src/flashcards/index.tsx, `pvp_ladder_title`)
    // — "Leo Park" is not unique to it on /vocabulary, so an unscoped `getByText` risks a
    // strict-mode violation. ----
    await page.goto('/vocabulary');
    await expect(
      page.locator('.mochi-card', { hasText: 'PvP ladder' }).getByText('Leo Park'),
    ).toBeVisible();

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
