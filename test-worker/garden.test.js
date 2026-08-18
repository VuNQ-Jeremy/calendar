import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as flashcardsSvc from '../server/services/flashcards';
import * as gardenSvc from '../server/services/garden';
import * as peopleSvc from '../server/services/people';
import * as classesSvc from '../server/services/classes';
import { gardenEvents, gardenPlants } from '../server/db/schema';
import { composeUtcFromIct, ictDateOf } from '../shared/logic/tests';

/**
 * Vườn cây từ vựng, against real D1.
 *
 * The lifecycle rules are unit-tested in test/garden-logic.test.ts; what can only be checked here
 * is the SQL underneath them — the plant upsert, the partial unique index that makes a replayed
 * harvest a no-op, the progress count, and the daily sweep.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

async function seedTopic(d) {
  const name = `Garden topic ${crypto.randomUUID()}`;
  await flashcardsSvc.createTopic(d, { name, color: 'violet' });
  const topic = (await flashcardsSvc.listTopics(d)).find((t) => t.name === name);
  await flashcardsSvc.createWord(d, topic.id, { word: 'seed', meaningVi: 'hạt' });
  return topic;
}

async function seedClassWithStudent(d) {
  const cls = await classesSvc.create(d, {
    name: `Garden class ${crypto.randomUUID()}`,
    subject: 'English',
    color: 'green',
    studentIds: [],
  });
  const student = await peopleSvc.createStudent(d, {
    name: 'Gardener',
    email: `g${crypto.randomUUID()}@test.com`,
    color: 'blue',
    classIds: [cls.id],
  });
  return { cls, student };
}

/** A full-marks round, played through the same path the web action uses. */
async function play(d, studentId, topicId, score = 10, total = 10, mode = 'quiz') {
  return flashcardsSvc.recordResultWithGarden(
    d,
    { kind: 'student', id: studentId },
    { topicId, mode, score, total, answers: [] },
  );
}

describe('a qualifying round grows the plant', () => {
  it('plants a seed, logs the grow, and credits the class tree', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { cls, student } = await seedClassWithStudent(d);

    const res = await play(d, student.id, topic.id);
    expect(res.recorded).toBe(true);
    expect(res.garden).toMatchObject({ qualified: true, grew: true, stage: 1, streak: 1 });

    const plant = await gardenSvc.getPlant(d, student.id);
    expect(plant.state.stage).toBe(1);
    expect(plant.state.isDead).toBe(false);
    expect(plant.potColor).toBe('orange');
    // 0050: the row the first play creates carries the pre-species drawing.
    expect(plant.species).toBe('classic');

    const events = await d.raw
      .select()
      .from(gardenEvents)
      .where(eq(gardenEvents.studentId, student.id));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('grow');

    const garden = await gardenSvc.classGarden(d, cls.id, '2026-08-07');
    expect(garden.tree.points).toBe(1);
    expect(garden.members).toHaveLength(1);
    expect(garden.members[0]).toMatchObject({ stage: 1, dead: false, wilted: false });
  });

  it('leaves the pot empty when the round misses the bar', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { student } = await seedClassWithStudent(d);

    const res = await play(d, student.id, topic.id, 3, 10);
    expect(res.recorded).toBe(true);
    expect(res.garden).toMatchObject({ qualified: false, grew: false, stage: 0 });
    expect(await gardenSvc.getPlant(d, student.id)).toBeNull();
  });

  it('stops at the daily cap but still records the round', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { student } = await seedClassWithStudent(d);

    await play(d, student.id, topic.id);
    await play(d, student.id, topic.id);
    const third = await play(d, student.id, topic.id);

    expect(third.garden).toMatchObject({ qualified: true, grew: false, stage: 2 });
    const events = await d.raw
      .select()
      .from(gardenEvents)
      .where(eq(gardenEvents.studentId, student.id));
    expect(events).toHaveLength(3);
  });

  it('never touches the garden for a staff play', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const teacher = await peopleSvc.createStaff(d, {
      name: 'Garden teacher',
      email: `t${crypto.randomUUID()}@test.com`,
      role: 'Teacher',
      color: 'orange',
    });
    const res = await flashcardsSvc.recordResultWithGarden(
      d,
      { kind: 'staff', id: teacher.id },
      { topicId: topic.id, mode: 'quiz', score: 10, total: 10, answers: [] },
    );
    expect(res.recorded).toBe(true);
    expect(res.garden).toBeNull();
  });
});

describe('watering and harvesting', () => {
  it('waters past the cap, then harvests exactly one fruit', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { student } = await seedClassWithStudent(d);
    const teacher = await peopleSvc.createStaff(d, {
      name: 'Waterer',
      email: `w${crypto.randomUUID()}@test.com`,
      role: 'Teacher',
      color: 'orange',
    });

    await play(d, student.id, topic.id);
    for (let i = 0; i < 4; i++) await gardenSvc.water(d, teacher.id, student.id, `boost ${i}`);

    const ripe = await gardenSvc.getPlant(d, student.id);
    expect(ripe.state.stage).toBe(5);

    const first = await gardenSvc.harvest(d, student.id);
    expect(first).toEqual({ ok: true, fruitsTotal: 1 });

    // A second tap must not bank a second fruit.
    const second = await gardenSvc.harvest(d, student.id);
    expect(second.ok).toBe(false);

    const after = await gardenSvc.getPlant(d, student.id);
    expect(after.state.fruitsTotal).toBe(1);
    expect(after.state.stage).toBe(1);

    const history = await gardenSvc.plantHistory(d, student.id);
    expect(history.filter((h) => h.type === 'harvest')).toHaveLength(1);
    expect(history.find((h) => h.type === 'water').staffName).toBe('Waterer');
  });

  it('renames the plant and repaints the pot', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { student } = await seedClassWithStudent(d);
    await play(d, student.id, topic.id);

    await gardenSvc.updatePlant(d, student.id, { plantName: 'Bé Xanh', potColor: 'violet' });
    const plant = await gardenSvc.getPlant(d, student.id);
    expect(plant.plantName).toBe('Bé Xanh');
    expect(plant.potColor).toBe('violet');
    // A patch that does not mention the species must leave it alone.
    expect(plant.species).toBe('classic');
  });
});

describe('assignments', () => {
  it('counts only qualifying rounds played after the assignment was made', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { cls, student } = await seedClassWithStudent(d);

    // A round played BEFORE the assignment exists must not count towards it.
    await play(d, student.id, topic.id);

    const id = await gardenSvc.createAssignment(
      d,
      {
        classId: cls.id,
        topicId: topic.id,
        requiredCount: 2,
        minScorePct: 80,
        deadline: '2099-12-31',
        note: null,
      },
      null,
    );

    let progress = await gardenSvc.assignmentProgress(d, id);
    expect(progress.rows).toEqual([expect.objectContaining({ studentId: student.id, done: 0 })]);

    await play(d, student.id, topic.id, 9, 10);
    await play(d, student.id, topic.id, 5, 10); // under the 80% bar
    progress = await gardenSvc.assignmentProgress(d, id);
    expect(progress.rows[0].done).toBe(1);

    const open = await gardenSvc.studentAssignments(d, student.id, new Date().toISOString());
    expect(open).toEqual([
      expect.objectContaining({ id, requiredCount: 2, done: 1, className: cls.name }),
    ]);

    await gardenSvc.updateAssignment(d, id, { requiredCount: 5 });
    expect((await gardenSvc.assignmentProgress(d, id)).assignment.requiredCount).toBe(5);

    await gardenSvc.deleteAssignment(d, id);
    expect(await gardenSvc.assignmentProgress(d, id)).toBeNull();
  });

  it("counts only rounds in the assignment's modes, and matches the threshold the same way", async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { cls, student } = await seedClassWithStudent(d);

    // Restricted to type+fill, with a bar LOWER than the free-study threshold (70), so which
    // bar applies is observable from whether a 60% round grows the plant.
    const id = await gardenSvc.createAssignment(
      d,
      {
        classId: cls.id,
        topicId: topic.id,
        requiredCount: 2,
        minScorePct: 50,
        deadline: '2099-12-31',
        note: null,
        modes: 'fill,type',
      },
      null,
    );

    // A perfect quiz round: qualifies as free study, but must NOT tick the counter.
    await play(d, student.id, topic.id);
    expect((await gardenSvc.assignmentProgress(d, id)).rows[0].done).toBe(0);

    // A 60% quiz round is an excluded mode: the assignment's 50% bar must not apply to it.
    const excluded = await play(d, student.id, topic.id, 6, 10);
    expect(excluded.garden).toMatchObject({ qualified: false });
    expect((await gardenSvc.assignmentProgress(d, id)).rows[0].done).toBe(0);

    // The same 60% in a required mode rides the assignment's bar — and ticks the counter.
    const included = await play(d, student.id, topic.id, 6, 10, 'type');
    expect(included.garden).toMatchObject({ qualified: true, thresholdPct: 50 });
    expect((await gardenSvc.assignmentProgress(d, id)).rows[0].done).toBe(1);

    // The student chip carries the CSV so the client can badge it.
    const open = await gardenSvc.studentAssignments(d, student.id, new Date().toISOString());
    expect(open[0]).toMatchObject({ id, modes: 'fill,type', done: 1 });

    // Clearing the restriction goes back to any-mode counting: both 60% rounds now qualify.
    await gardenSvc.updateAssignment(d, id, { modes: null });
    expect((await gardenSvc.assignmentProgress(d, id)).rows[0].done).toBe(3);
  });

  it('a deadline time closes the window before the deadline day ends', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { cls, student } = await seedClassWithStudent(d);
    const nowIso = new Date().toISOString();

    // Due TODAY at ICT midnight: the deadline day is still running, but its instant has gone.
    const id = await gardenSvc.createAssignment(
      d,
      {
        classId: cls.id,
        topicId: topic.id,
        requiredCount: 1,
        minScorePct: 80,
        deadline: ictDateOf(nowIso),
        deadlineTime: '00:00',
        note: null,
      },
      null,
    );

    await play(d, student.id, topic.id);
    expect((await gardenSvc.assignmentProgress(d, id)).rows[0].done).toBe(0);
    expect(await gardenSvc.studentAssignments(d, student.id, nowIso)).toEqual([]);

    // Clearing the time restores the pre-0036 meaning — the whole day counts — and the same
    // round now qualifies.
    await gardenSvc.updateAssignment(d, id, { deadlineTime: null });
    expect((await gardenSvc.assignmentProgress(d, id)).rows[0].done).toBe(1);
    expect(await gardenSvc.studentAssignments(d, student.id, nowIso)).toEqual([
      expect.objectContaining({ id, deadlineTime: null, done: 1 }),
    ]);
  });

  it('windows the report list by deadline month, missed deadlines included', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { cls, student } = await seedClassWithStudent(d);

    const inMonth = await gardenSvc.createAssignment(
      d,
      {
        classId: cls.id,
        topicId: topic.id,
        requiredCount: 1,
        minScorePct: 80,
        deadline: '2099-09-20',
        note: null,
      },
      null,
    );
    await gardenSvc.createAssignment(
      d,
      {
        classId: cls.id,
        topicId: topic.id,
        requiredCount: 1,
        minScorePct: 80,
        deadline: '2099-10-05',
        note: null,
      },
      null,
    );

    // Only the September deadline is in the reported window, and it is unfinished so far.
    let rows = await gardenSvc.studentAssignmentsInMonth(d, student.id, '2099-09');
    expect(rows).toEqual([
      expect.objectContaining({ id: inMonth, done: 0, requiredCount: 1, completed: false }),
    ]);

    await play(d, student.id, topic.id);
    rows = await gardenSvc.studentAssignmentsInMonth(d, student.id, '2099-09');
    expect(rows[0]).toMatchObject({ done: 1, completed: true, className: cls.name });
  });
});

describe('the daily sweep', () => {
  it('charges a missed deadline once, however often it runs', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { cls, student } = await seedClassWithStudent(d);

    await play(d, student.id, topic.id);
    await play(d, student.id, topic.id);
    expect((await gardenSvc.getPlant(d, student.id)).state.stage).toBe(2);

    await gardenSvc.createAssignment(
      d,
      {
        classId: cls.id,
        topicId: topic.id,
        requiredCount: 9,
        minScorePct: 80,
        deadline: '2026-08-01',
        note: null,
      },
      null,
    );

    const now = composeUtcFromIct('2026-08-05', '08:00');
    const first = await gardenSvc.runGardenSweep(d, now);
    expect(first.penalties.filter((p) => p.studentId === student.id)).toHaveLength(1);

    const afterOne = await gardenSvc.getPlant(d, student.id);
    expect(afterOne.state.stage).toBe(1);
    expect(afterOne.state.wiltedSince).toBe('2026-08-05');

    const second = await gardenSvc.runGardenSweep(d, now);
    expect(second.penalties.filter((p) => p.studentId === student.id)).toHaveLength(0);
    expect((await gardenSvc.getPlant(d, student.id)).state.stage).toBe(1);
  });

  it('writes one album per class per month and never overwrites it', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { cls, student } = await seedClassWithStudent(d);
    await play(d, student.id, topic.id);

    expect(await gardenSvc.snapshotMonth(d, '2026-07', cls.id)).toBe(1);
    expect(await gardenSvc.snapshotMonth(d, '2026-07', cls.id)).toBe(0);

    const months = await gardenSvc.listSnapshots(d, cls.id);
    expect(months.map((m) => m.month)).toEqual(['2026-07']);

    const snap = await gardenSvc.getSnapshot(d, cls.id, '2026-07');
    expect(snap.className).toBe(cls.name);
    expect(snap.data.members).toHaveLength(1);
    expect(snap.data.members[0].name).toBe('Gardener');
  });

  it('persists overdue decay and reports who to warn', async () => {
    const d = db();
    const topic = await seedTopic(d);
    const { student } = await seedClassWithStudent(d);
    await play(d, student.id, topic.id);
    await play(d, student.id, topic.id);

    // Backdate the last care so the plant is three days idle: wilting today.
    await d.raw
      .update(gardenPlants)
      .set({ lastCareDay: '2026-08-02', growDay: '2026-08-02' })
      .where(eq(gardenPlants.studentId, student.id));

    const res = await gardenSvc.runGardenSweep(d, composeUtcFromIct('2026-08-05', '08:00'));
    expect(res.wiltingToday.some((w) => w.studentId === student.id)).toBe(true);

    const plant = await gardenSvc.getPlant(d, student.id);
    expect(plant.state.wiltedSince).toBe('2026-08-05');
    expect(plant.state.stage).toBe(2);
  });
});
