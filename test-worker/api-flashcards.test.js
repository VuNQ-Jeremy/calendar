import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createDb } from '../server/db/index';
import * as flashcardsSvc from '../server/services/flashcards';
import * as peopleSvc from '../server/services/people';
import * as pushSvc from '../server/services/push';
import { hashPassword } from '../server/services/crypto';
import { accounts, flashcardResults, flashcardMastery, pushTokens } from '../server/db/schema';

/**
 * Flashcard result idempotency — the property Phase 3's offline outbox depends on.
 *
 * Without it, a flush that succeeds server-side but drops on the way back gets retried and
 * double-counts the student's score. The outbox retries blindly, so this must hold.
 */

function db() {
  return createDb(env);
}

async function seedTopicWithWord(d) {
  // createTopic returns void, so read the row back by its (unique-per-test) name.
  const name = `Topic ${crypto.randomUUID()}`;
  await flashcardsSvc.createTopic(d, { name, color: 'violet' });
  const topic = (await flashcardsSvc.listTopics(d)).find((t) => t.name === name);
  await flashcardsSvc.createWord(d, topic.id, { word: 'apple', meaningVi: 'quả táo' });
  const words = await flashcardsSvc.listWords(d, topic.id);
  return { topic, word: words[0] };
}

async function seedStudent(d) {
  const student = await peopleSvc.createStudent(d, {
    name: 'Player',
    email: `p${crypto.randomUUID()}@test.com`,
    color: 'blue',
    classIds: [],
  });
  return student;
}

async function seedStaff(d) {
  return peopleSvc.createStaff(d, {
    name: 'Teacher Player',
    email: `t${crypto.randomUUID()}@test.com`,
    role: 'Teacher',
    color: 'orange',
  });
}

describe('recordResult idempotency', () => {
  it('records a result with a clientId once', async () => {
    const d = db();
    const { topic, word } = await seedTopicWithWord(d);
    const student = await seedStudent(d);
    const clientId = crypto.randomUUID();

    const first = await flashcardsSvc.recordResult(
      d,
      { kind: 'student', id: student.id },
      { clientId, topicId: topic.id, mode: 'flip', score: 1, total: 1, answers: [{ wordId: word.id, correct: true }] },
    );
    expect(first).toBe(true);

    const rows = await d.select().from(flashcardResults).where(eq(flashcardResults.clientId, clientId));
    expect(rows).toHaveLength(1);
  });

  it('is a no-op when the same clientId is replayed', async () => {
    const d = db();
    const { topic, word } = await seedTopicWithWord(d);
    const student = await seedStudent(d);
    const clientId = crypto.randomUUID();
    const payload = {
      clientId,
      topicId: topic.id,
      mode: 'flip',
      score: 1,
      total: 1,
      answers: [{ wordId: word.id, correct: true }],
    };

    expect(await flashcardsSvc.recordResult(d, { kind: 'student', id: student.id }, payload)).toBe(true);
    expect(await flashcardsSvc.recordResult(d, { kind: 'student', id: student.id }, payload)).toBe(false);

    const rows = await d.select().from(flashcardResults).where(eq(flashcardResults.clientId, clientId));
    expect(rows).toHaveLength(1);
  });

  it('does not double-count mastery on replay', async () => {
    // The subtle half: deduping the result row is not enough — re-applying the mastery
    // increments would still inflate the student's stats.
    const d = db();
    const { topic, word } = await seedTopicWithWord(d);
    const student = await seedStudent(d);
    const payload = {
      clientId: crypto.randomUUID(),
      topicId: topic.id,
      mode: 'flip',
      score: 1,
      total: 1,
      answers: [{ wordId: word.id, correct: true }],
    };

    await flashcardsSvc.recordResult(d, { kind: 'student', id: student.id }, payload);
    await flashcardsSvc.recordResult(d, { kind: 'student', id: student.id }, payload);

    const mastery = await d
      .select()
      .from(flashcardMastery)
      .where(eq(flashcardMastery.studentId, student.id));
    expect(mastery).toHaveLength(1);
    expect(mastery[0].correct).toBe(1);
  });

  it('still records every play when no clientId is sent (the web path)', async () => {
    const d = db();
    const { topic, word } = await seedTopicWithWord(d);
    const student = await seedStudent(d);
    const payload = {
      topicId: topic.id,
      mode: 'flip',
      score: 1,
      total: 1,
      answers: [{ wordId: word.id, correct: true }],
    };

    await flashcardsSvc.recordResult(d, { kind: 'student', id: student.id }, payload);
    await flashcardsSvc.recordResult(d, { kind: 'student', id: student.id }, payload);

    const rows = await d.select().from(flashcardResults).where(eq(flashcardResults.topicId, topic.id));
    expect(rows).toHaveLength(2);
  });

  it('recordResults reports how many were new', async () => {
    const d = db();
    const { topic, word } = await seedTopicWithWord(d);
    const student = await seedStudent(d);
    const mk = () => ({
      clientId: crypto.randomUUID(),
      topicId: topic.id,
      mode: 'flip',
      score: 1,
      total: 1,
      answers: [{ wordId: word.id, correct: true }],
    });
    const a = mk();
    const b = mk();

    expect(await flashcardsSvc.recordResults(d, { kind: 'student', id: student.id }, [a, b])).toBe(2);
    // Replaying the batch, plus one genuinely new result.
    expect(await flashcardsSvc.recordResults(d, { kind: 'student', id: student.id }, [a, b, mk()])).toBe(1);
  });
});

describe('staff vs student plays', () => {
  it('a student play sets student_id and creates mastery', async () => {
    const d = db();
    const { topic, word } = await seedTopicWithWord(d);
    const student = await seedStudent(d);

    await flashcardsSvc.recordResult(
      d,
      { kind: 'student', id: student.id },
      { topicId: topic.id, mode: 'flip', score: 1, total: 1, answers: [{ wordId: word.id, correct: true }] },
    );

    const rows = await d.select().from(flashcardResults).where(eq(flashcardResults.topicId, topic.id));
    expect(rows[0].studentId).toBe(student.id);
    expect(rows[0].staffId).toBeNull();

    const mastery = await d.select().from(flashcardMastery).where(eq(flashcardMastery.wordId, word.id));
    expect(mastery).toHaveLength(1);
  });

  it('a staff play sets staff_id and creates NO mastery', async () => {
    // A teacher testing a topic must not pollute student stats.
    const d = db();
    const { topic, word } = await seedTopicWithWord(d);
    const teacher = await seedStaff(d);

    await flashcardsSvc.recordResult(
      d,
      { kind: 'staff', id: teacher.id },
      { topicId: topic.id, mode: 'flip', score: 1, total: 1, answers: [{ wordId: word.id, correct: true }] },
    );

    const rows = await d.select().from(flashcardResults).where(eq(flashcardResults.topicId, topic.id));
    expect(rows[0].staffId).toBe(teacher.id);
    expect(rows[0].studentId).toBeNull();

    const mastery = await d.select().from(flashcardMastery).where(eq(flashcardMastery.wordId, word.id));
    expect(mastery).toHaveLength(0);
  });
});

describe('push token registry', () => {
  async function seedAccount(d) {
    const staffRow = await seedStaff(d);
    const accountId = crypto.randomUUID();
    await d.insert(accounts).values({
      id: accountId,
      email: `acct${crypto.randomUUID()}@test.com`,
      passwordHash: await hashPassword('pw'),
      staffId: staffRow.id,
      createdAt: new Date().toISOString(),
    });
    return accountId;
  }

  it('registers a device', async () => {
    const d = db();
    const accountId = await seedAccount(d);
    const token = `ExponentPushToken[${crypto.randomUUID()}]`;

    await pushSvc.registerToken(d, accountId, token, 'android');
    const rows = await d.select().from(pushTokens).where(eq(pushTokens.expoToken, token));
    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).toBe(accountId);
  });

  it('MOVES a token when a different account signs in on the same device', async () => {
    // Otherwise the previous user's notifications keep arriving on this handset.
    const d = db();
    const first = await seedAccount(d);
    const second = await seedAccount(d);
    const token = `ExponentPushToken[${crypto.randomUUID()}]`;

    await pushSvc.registerToken(d, first, token, 'android');
    await pushSvc.registerToken(d, second, token, 'android');

    const rows = await d.select().from(pushTokens).where(eq(pushTokens.expoToken, token));
    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).toBe(second);
  });

  it('unregisters and prunes', async () => {
    const d = db();
    const accountId = await seedAccount(d);
    const token = `ExponentPushToken[${crypto.randomUUID()}]`;

    await pushSvc.registerToken(d, accountId, token, 'android');
    expect(await pushSvc.tokensForAccounts(d, [accountId])).toContain(token);

    await pushSvc.unregisterToken(d, token);
    expect(await pushSvc.tokensForAccounts(d, [accountId])).not.toContain(token);
  });
});
