import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as flashcardsSvc from '../server/services/flashcards';
import * as peopleSvc from '../server/services/people';
import { flashcardMastery } from '../server/db/schema';
import { addDaysVn } from '../shared/logic/garden';
import { ictDateOf } from '../shared/logic/tests';

/**
 * Ôn tập, through the service: the ladder rules are unit-tested in test/review-logic.test.ts, so
 * what is checked here is the wiring nothing else covers — that a finished round actually writes a
 * schedule, that the due queries find it, and that the settings row is what the write reads.
 *
 * `today` is the server's ICT day, exactly as `recordResultWithGarden` computes it, so these
 * assertions do not drift when the suite runs across ICT midnight.
 */

const today = () => ictDateOf(new Date().toISOString());

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

async function seedTopicWithWords(d, count = 1) {
  const name = `Review topic ${crypto.randomUUID()}`;
  await flashcardsSvc.createTopic(d, { name, color: 'violet' });
  const topic = (await flashcardsSvc.listTopics(d)).find((t) => t.name === name);
  for (let i = 0; i < count; i++) {
    await flashcardsSvc.createWord(d, topic.id, { word: `word${i}`, meaningVi: `từ ${i}` });
  }
  return { topic, words: await flashcardsSvc.listWords(d, topic.id) };
}

async function seedStudent(d) {
  return peopleSvc.createStudent(d, {
    name: 'Reviewer',
    email: `r${crypto.randomUUID()}@test.com`,
    color: 'blue',
    classIds: [],
  });
}

function play(d, student, topic, answers) {
  return flashcardsSvc.recordResult(
    d,
    { kind: 'student', id: student.id },
    {
      topicId: topic.id,
      mode: 'flip',
      score: answers.filter((a) => a.correct).length,
      total: answers.length,
      answers,
    },
  );
}

async function masteryOf(d, student, word) {
  const rows = await d.raw
    .select()
    .from(flashcardMastery)
    .where(and(eq(flashcardMastery.studentId, student.id), eq(flashcardMastery.wordId, word.id)));
  return rows[0];
}

/** Force a word to look due (or overdue) without waiting days for it. */
function backdate(d, student, word, level, dueDay) {
  return d.raw
    .update(flashcardMastery)
    .set({ level, dueDay })
    .where(and(eq(flashcardMastery.studentId, student.id), eq(flashcardMastery.wordId, word.id)));
}

describe('review scheduling', () => {
  it('schedules a word the first time it is answered', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);

    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);

    const row = await masteryOf(d, student, words[0]);
    expect(row.level).toBe(0);
    // The default ladder's first rung is 3 days.
    expect(row.dueDay).toBe(addDaysVn(today(), 3));
  });

  it('advances a rung when a due word is answered correctly', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);

    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);
    await backdate(d, student, words[0], 0, addDaysVn(today(), -1)); // due yesterday
    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);

    const row = await masteryOf(d, student, words[0]);
    expect(row.level).toBe(1);
    expect(row.dueDay).toBe(addDaysVn(today(), 5));
  });

  it('steps back a rung on a wrong answer', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);

    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);
    await backdate(d, student, words[0], 3, today());
    await play(d, student, topic, [{ wordId: words[0].id, correct: false }]);

    const row = await masteryOf(d, student, words[0]);
    expect(row.level).toBe(2);
    expect(row.dueDay).toBe(addDaysVn(today(), 7));
  });

  it('leaves the schedule alone when a not-yet-due word is practised', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);

    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);
    const before = await masteryOf(d, student, words[0]);
    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);

    const after = await masteryOf(d, student, words[0]);
    expect(after.dueDay).toBe(before.dueDay);
    expect(after.level).toBe(before.level);
    // The counters still moved — only the schedule held still.
    expect(after.correct).toBe(2);
  });

  it('never advances twice for a replayed offline flush', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);
    const payload = {
      clientId: crypto.randomUUID(),
      topicId: topic.id,
      mode: 'flip',
      score: 1,
      total: 1,
      answers: [{ wordId: words[0].id, correct: true }],
    };

    await flashcardsSvc.recordResult(d, { kind: 'student', id: student.id }, payload);
    await backdate(d, student, words[0], 0, addDaysVn(today(), -1));
    // The replay is dropped whole, so the ladder cannot climb on it.
    expect(await flashcardsSvc.recordResult(d, { kind: 'student', id: student.id }, payload)).toBe(
      false,
    );

    const row = await masteryOf(d, student, words[0]);
    expect(row.level).toBe(0);
  });

  it('schedules nothing for a staff play', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const teacher = await peopleSvc.createStaff(d, {
      name: 'Teacher Reviewer',
      email: `t${crypto.randomUUID()}@test.com`,
      role: 'Teacher',
      color: 'orange',
    });

    await flashcardsSvc.recordResult(
      d,
      { kind: 'staff', id: teacher.id },
      {
        topicId: topic.id,
        mode: 'flip',
        score: 1,
        total: 1,
        answers: [{ wordId: words[0].id, correct: true }],
      },
    );

    const rows = await d.raw
      .select()
      .from(flashcardMastery)
      .where(eq(flashcardMastery.wordId, words[0].id));
    expect(rows).toHaveLength(0);
  });
});

describe('due queries', () => {
  it('lists only due words, grouped under their topic', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d, 3);
    const student = await seedStudent(d);

    await play(
      d,
      student,
      topic,
      words.map((w) => ({ wordId: w.id, correct: true })),
    );
    // Two overdue, one still in the future.
    await backdate(d, student, words[0], 0, addDaysVn(today(), -2));
    await backdate(d, student, words[1], 0, today());

    const { groups, total } = await flashcardsSvc.listDueForStudent(d, student.id, today());
    expect(total).toBe(2);
    const group = groups.find((g) => g.topic.id === topic.id);
    expect(group.wordIds.sort()).toEqual([words[0].id, words[1].id].sort());
    expect(group.topic.name).toBe(topic.name);
  });

  it('counts the same rows the list returns', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d, 2);
    const student = await seedStudent(d);

    expect(await flashcardsSvc.countDueForStudent(d, student.id, today())).toBe(0);

    await play(
      d,
      student,
      topic,
      words.map((w) => ({ wordId: w.id, correct: true })),
    );
    // Freshly played: scheduled into the future, so nothing is owed yet.
    expect(await flashcardsSvc.countDueForStudent(d, student.id, today())).toBe(0);

    await backdate(d, student, words[0], 0, today());
    expect(await flashcardsSvc.countDueForStudent(d, student.id, today())).toBe(1);
  });

  it('ignores a word that is not in the cycle at all', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);

    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);
    await backdate(d, student, words[0], 0, null);

    expect(await flashcardsSvc.countDueForStudent(d, student.id, today())).toBe(0);
  });

  it('carries the schedule into the topic bundle both clients read', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);

    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);

    const mastery = await flashcardsSvc.listMasteryForStudent(d, student.id, topic.id);
    expect(mastery[0].level).toBe(0);
    expect(mastery[0].dueDay).toBe(addDaysVn(today(), 3));
  });
});

describe('review settings', () => {
  it('defaults to the 3/5/7/14/30 ladder', async () => {
    expect((await flashcardsSvc.getReviewSettings(db())).intervals).toEqual([3, 5, 7, 14, 30]);
  });

  it('round-trips a saved ladder, and the write path schedules on it', async () => {
    const d = db();
    await flashcardsSvc.setReviewSettings(d, { intervals: [1, 2, 4, 8, 16] });
    try {
      expect((await flashcardsSvc.getReviewSettings(d)).intervals).toEqual([1, 2, 4, 8, 16]);

      const { topic, words } = await seedTopicWithWords(d);
      const student = await seedStudent(d);
      await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);

      const row = await masteryOf(d, student, words[0]);
      expect(row.dueDay).toBe(addDaysVn(today(), 1));
    } finally {
      // School-wide row: put it back, or every later test in this file schedules on 1/2/4/8/16.
      await flashcardsSvc.setReviewSettings(d, { intervals: [3, 5, 7, 14, 30] });
    }
  });

  it('stores a ladder of any length the admin builds', async () => {
    const d = db();
    await flashcardsSvc.setReviewSettings(d, { intervals: [2, 4, 6, 9, 12, 20, 45] });
    try {
      expect((await flashcardsSvc.getReviewSettings(d)).intervals).toEqual([
        2, 4, 6, 9, 12, 20, 45,
      ]);

      // And a shorter one: rows parked above the new top are not orphaned — they clamp on the next
      // answer rather than being rewritten here.
      await flashcardsSvc.setReviewSettings(d, { intervals: [5] });
      expect((await flashcardsSvc.getReviewSettings(d)).intervals).toEqual([5]);
    } finally {
      await flashcardsSvc.setReviewSettings(d, { intervals: [3, 5, 7, 14, 30] });
    }
  });
});

/**
 * The admin log's read (/logs). Shares a database with every other test in this suite, so these
 * assertions are scoped to the students they create rather than to the whole table.
 */
describe('listScheduledWords', () => {
  it('reports the stored schedule, joined to student, word and topic', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);

    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);

    const rows = await flashcardsSvc.listScheduledWords(d, { studentId: student.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentId: student.id,
      studentName: 'Reviewer',
      wordId: words[0].id,
      word: 'word0',
      meaningVi: 'từ 0',
      topicId: topic.id,
      topicName: topic.name,
      level: 0,
      dueDay: addDaysVn(today(), 3),
      correct: 1,
      wrong: 0,
    });
  });

  it('filters to one student, and unfiltered covers them all', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d, 2);
    const a = await seedStudent(d);
    const b = await seedStudent(d);

    await play(d, a, topic, [{ wordId: words[0].id, correct: true }]);
    await play(d, b, topic, [
      { wordId: words[0].id, correct: true },
      { wordId: words[1].id, correct: false },
    ]);

    expect(await flashcardsSvc.listScheduledWords(d, { studentId: a.id })).toHaveLength(1);
    expect(await flashcardsSvc.listScheduledWords(d, { studentId: b.id })).toHaveLength(2);

    // Unfiltered is school-wide: it must contain both students' rows. Scoped by id because other
    // tests in this suite have scheduled words of their own.
    const all = await flashcardsSvc.listScheduledWords(d, { limit: 500 });
    const mine = all.filter((r) => r.studentId === a.id || r.studentId === b.id);
    expect(mine).toHaveLength(3);
  });

  it('puts the most overdue word first', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d, 3);
    const student = await seedStudent(d);

    await play(
      d,
      student,
      topic,
      words.map((w) => ({ wordId: w.id, correct: true })),
    );
    await backdate(d, student, words[0], 0, addDaysVn(today(), -1));
    await backdate(d, student, words[1], 0, addDaysVn(today(), -30));
    await backdate(d, student, words[2], 0, addDaysVn(today(), 10));

    const rows = await flashcardsSvc.listScheduledWords(d, { studentId: student.id });
    expect(rows.map((r) => r.wordId)).toEqual([words[1].id, words[0].id, words[2].id]);
  });

  it('omits a word that is not on the ladder, and every staff play', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d);
    const student = await seedStudent(d);
    const teacher = await peopleSvc.createStaff(d, {
      name: 'Teacher Logs',
      email: `t${crypto.randomUUID()}@test.com`,
      role: 'Teacher',
      color: 'orange',
    });

    await play(d, student, topic, [{ wordId: words[0].id, correct: true }]);
    await backdate(d, student, words[0], 0, null);
    await flashcardsSvc.recordResult(
      d,
      { kind: 'staff', id: teacher.id },
      {
        topicId: topic.id,
        mode: 'flip',
        score: 1,
        total: 1,
        answers: [{ wordId: words[0].id, correct: true }],
      },
    );

    const rows = await flashcardsSvc.listScheduledWords(d, { studentId: student.id });
    expect(rows).toEqual([]);
  });

  it('honours the row limit', async () => {
    const d = db();
    const { topic, words } = await seedTopicWithWords(d, 3);
    const student = await seedStudent(d);

    await play(
      d,
      student,
      topic,
      words.map((w) => ({ wordId: w.id, correct: true })),
    );

    expect(
      await flashcardsSvc.listScheduledWords(d, { studentId: student.id, limit: 2 }),
    ).toHaveLength(2);
  });
});
