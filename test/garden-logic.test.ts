import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GARDEN_SETTINGS,
  MAX_STAGE,
  SEED_STAGE,
  addDaysVn,
  applyDeadlineCheck,
  applyHarvest,
  applyQualifyingPlay,
  applyWatering,
  classTreeLevel,
  classTreeNext,
  daysBetweenVn,
  effectiveStreak,
  emptyMonthTally,
  growthThresholdPct,
  isQualifying,
  newSeedState,
  plantView,
  scorePct,
  settlePlant,
  tallyGardenMonth,
  titleForFruit,
  type GardenEventDraft,
  type GardenSettings,
  type PlantState,
  type PlantTransition,
} from '../shared/logic/garden.js';
import { composeUtcFromIct } from '../shared/logic/tests.js';

/** N=3, M=7, cap=2, and a 80% bar so 8/10 passes and 7/10 does not. */
const S: GardenSettings = { ...DEFAULT_GARDEN_SETTINGS, freeMinScorePct: 80 };

/** An ICT day (and optional ICT clock time) as the UTC instant the server would store. */
function at(day: string, time = '10:00'): string {
  return composeUtcFromIct(day, time);
}

function plant(over: Partial<PlantState> = {}): PlantState {
  return { ...newSeedState('2026-08-01'), ...over };
}

/** A plant last cared for on `day`, at `stage`, with nothing charged for neglect yet. */
function idleSince(day: string, stage: number, over: Partial<PlantState> = {}): PlantState {
  return plant({ stage, lastCareDay: day, growDay: day, dropsTaken: 0, ...over });
}

function types(events: GardenEventDraft[]): string[] {
  return events.map((e) => e.type);
}

function ok(t: PlantTransition | { error: string } | null): PlantTransition {
  if (!t || 'error' in t) throw new Error(`expected a transition, got ${JSON.stringify(t)}`);
  return t;
}

describe('ICT day arithmetic', () => {
  it('steps and subtracts days across month and year ends', () => {
    expect(addDaysVn('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysVn('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetweenVn('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetweenVn('2026-08-11', '2026-08-01')).toBe(-10);
  });
});

describe('isQualifying()', () => {
  it('treats the threshold as inclusive, in integer math', () => {
    expect(isQualifying(8, 10, 80)).toBe(true);
    expect(isQualifying(7, 10, 80)).toBe(false);
    // 7/9 = 77.8% — under 78, over 77.
    expect(isQualifying(7, 9, 78)).toBe(false);
    expect(isQualifying(7, 9, 77)).toBe(true);
  });

  it('never qualifies an empty round', () => {
    expect(isQualifying(0, 0, 0)).toBe(false);
    expect(scorePct(0, 0)).toBe(0);
  });
});

describe('growthThresholdPct()', () => {
  it('takes the most forgiving bar so an assigned topic is never the hardest to grow', () => {
    expect(growthThresholdPct([], S)).toBe(80);
    expect(growthThresholdPct([50], S)).toBe(50);
    expect(growthThresholdPct([90], S)).toBe(80);
    expect(growthThresholdPct([90, 60], S)).toBe(60);
  });
});

describe('titleForFruit() / class tree', () => {
  it('awards titles at 5, 10 and 25 fruit', () => {
    expect(titleForFruit(4)).toBeNull();
    expect(titleForFruit(5)).toBe('gardener5');
    expect(titleForFruit(9)).toBe('gardener5');
    expect(titleForFruit(24)).toBe('gardener10');
    expect(titleForFruit(25)).toBe('gardener25');
    expect(titleForFruit(1000)).toBe('gardener25');
  });

  it('levels the class tree on cumulative plays and stops at the top', () => {
    expect(classTreeLevel(0)).toBe(0);
    expect(classTreeLevel(19)).toBe(0);
    expect(classTreeLevel(20)).toBe(1);
    expect(classTreeLevel(99)).toBe(2);
    expect(classTreeNext(0)).toBe(20);
    expect(classTreeNext(20)).toBe(50);
    expect(classTreeNext(99_999)).toBeNull();
  });
});

describe('applyQualifyingPlay()', () => {
  it('plants a seed on the very first round', () => {
    const t = applyQualifyingPlay(null, S, at('2026-08-01'), 'r1');
    expect(t.state.stage).toBe(SEED_STAGE);
    expect(t.state.streakDays).toBe(1);
    expect(t.events).toEqual([
      { type: 'grow', stageBefore: 0, stageAfter: 1, vnDay: '2026-08-01', refId: 'r1' },
    ]);
  });

  it('grows a second stage the same day, then stops at the daily cap', () => {
    const a = applyQualifyingPlay(null, S, at('2026-08-01'), 'r1');
    const b = applyQualifyingPlay(a.state, S, at('2026-08-01', '11:00'), 'r2');
    expect(b.state.stage).toBe(2);
    expect(b.state.growCount).toBe(2);

    const c = applyQualifyingPlay(b.state, S, at('2026-08-01', '12:00'), 'r3');
    expect(c.state.stage).toBe(2);
    // The capped round is still logged — it is the qualifying-play ledger.
    expect(c.events).toHaveLength(1);
    expect(c.events[0]).toMatchObject({ type: 'grow', stageBefore: 2, stageAfter: 2 });
    expect(c.state.streakDays).toBe(1);
  });

  it('resets the cap at ICT midnight, and counts the streak by ICT day', () => {
    const a = applyQualifyingPlay(null, S, at('2026-08-01', '23:50'), 'r1');
    const b = applyQualifyingPlay(a.state, S, at('2026-08-01', '23:55'), 'r2');
    expect(b.state.stage).toBe(2);
    // 00:10 ICT the next day is a different ICT day, though only 15 minutes later.
    const c = applyQualifyingPlay(b.state, S, at('2026-08-02', '00:10'), 'r3');
    expect(c.state.stage).toBe(3);
    expect(c.state.streakDays).toBe(2);
  });

  it('restarts the streak after a missed day', () => {
    const a = applyQualifyingPlay(null, S, at('2026-08-01'), 'r1');
    const b = applyQualifyingPlay(a.state, S, at('2026-08-03'), 'r2');
    expect(b.state.streakDays).toBe(1);
    expect(effectiveStreak(b.state, '2026-08-03')).toBe(1);
    expect(effectiveStreak(b.state, '2026-08-04')).toBe(1);
    expect(effectiveStreak(b.state, '2026-08-05')).toBe(0);
  });

  it('settles the neglect first, then revives and grows', () => {
    // Stage 4, last cared for Aug 1, returning Aug 21: wilt Aug 4, drops Aug 11 and Aug 18.
    const t = applyQualifyingPlay(idleSince('2026-08-01', 4), S, at('2026-08-21'), 'r9');
    expect(types(t.events)).toEqual(['wilt', 'decay_drop', 'decay_drop', 'grow']);
    expect(t.events.map((e) => e.vnDay)).toEqual([
      '2026-08-04',
      '2026-08-11',
      '2026-08-18',
      '2026-08-21',
    ]);
    expect(t.state.stage).toBe(3);
    expect(t.state.wiltedSince).toBeNull();
    expect(t.state.streakDays).toBe(1);
  });

  it('replants a dead plant as a fresh seed', () => {
    const dead = settlePlant(idleSince('2026-08-01', 1), S, '2026-08-11').state;
    expect(dead.isDead).toBe(true);

    const t = applyQualifyingPlay(dead, S, at('2026-08-11'), 'r1');
    expect(types(t.events)).toEqual(['revive']);
    expect(t.state.stage).toBe(SEED_STAGE);
    expect(t.state.isDead).toBe(false);
    expect(t.state.growCount).toBe(1);

    const second = applyQualifyingPlay(t.state, S, at('2026-08-11', '12:00'), 'r2');
    expect(second.state.stage).toBe(2);
  });

  it('keeps a plant at fruit when it is already ripe', () => {
    const t = applyQualifyingPlay(plant({ stage: MAX_STAGE }), S, at('2026-08-02'), 'r1');
    expect(t.state.stage).toBe(MAX_STAGE);
    expect(t.events[0]).toMatchObject({ stageBefore: 5, stageAfter: 5 });
    expect(t.state.streakDays).toBe(1);
  });
});

describe('settlePlant()', () => {
  it('marks the wilt on a fixed day without changing the stage', () => {
    const t = settlePlant(idleSince('2026-08-01', 3), S, '2026-08-04');
    expect(types(t.events)).toEqual(['wilt']);
    expect(t.state.wiltedSince).toBe('2026-08-04');
    expect(t.state.stage).toBe(3);
  });

  it('does nothing before the wilt day', () => {
    const t = settlePlant(idleSince('2026-08-01', 3), S, '2026-08-03');
    expect(t.events).toEqual([]);
    expect(t.state.wiltedSince).toBeNull();
  });

  it('drops a stage every M days after the wilt', () => {
    const t = settlePlant(idleSince('2026-08-01', 3), S, '2026-08-11');
    expect(types(t.events)).toEqual(['wilt', 'decay_drop']);
    expect(t.events[1]).toMatchObject({ vnDay: '2026-08-11', stageBefore: 3, stageAfter: 2 });
  });

  it('dies instead of dropping below seed, and rots no further', () => {
    const t = settlePlant(idleSince('2026-08-01', 1), S, '2026-08-11');
    expect(types(t.events)).toEqual(['wilt', 'die']);
    expect(t.state.stage).toBe(0);
    expect(t.state.isDead).toBe(true);

    const later = settlePlant(t.state, S, '2026-09-30');
    expect(later.events).toEqual([]);
    expect(later.state.stage).toBe(0);
  });

  it('is idempotent and composable — the lazy read and the cron always agree', () => {
    const start = idleSince('2026-08-01', 5);

    // Settling in every possible sequence of steps must land on the same state and emit the
    // same events as settling once. This is the property the whole design rests on.
    for (let cut = 1; cut <= 40; cut++) {
      const end = addDaysVn('2026-08-01', 40);
      const mid = addDaysVn('2026-08-01', cut);

      const direct = settlePlant(start, S, end);
      const first = settlePlant(start, S, mid);
      const second = settlePlant(first.state, S, end);

      expect(second.state).toEqual(direct.state);
      expect([...first.events, ...second.events]).toEqual(direct.events);
    }
  });

  it('never touches fruit, streak or the growth counter', () => {
    const before = idleSince('2026-08-01', 4, {
      fruitsTotal: 7,
      streakDays: 9,
      streakLastDay: '2026-08-01',
      growCount: 2,
    });
    const after = settlePlant(before, S, '2026-09-01').state;
    expect(after.fruitsTotal).toBe(7);
    expect(after.streakDays).toBe(9);
    expect(after.streakLastDay).toBe('2026-08-01');
    expect(after.growCount).toBe(2);
  });

  it('does not re-charge a plant when the admin lengthens the intervals', () => {
    // One drop taken on Aug 11, then the admin doubles the drop interval.
    const once = settlePlant(idleSince('2026-08-01', 5), S, '2026-08-11');
    expect(once.state.stage).toBe(4);
    expect(once.state.dropsTaken).toBe(1);

    const slower: GardenSettings = { ...S, dropAfterDays: 14 };
    const later = settlePlant(once.state, slower, '2026-08-18');
    // 17 idle days at M=14 is one drop's worth, and one drop has already been charged.
    expect(later.state.stage).toBe(4);
    expect(later.events).toEqual([]);
  });

  it('resets the neglect charge as soon as the plant is cared for', () => {
    const dropped = settlePlant(idleSince('2026-08-01', 5), S, '2026-08-11').state;
    expect(dropped.dropsTaken).toBe(1);

    const played = applyQualifyingPlay(dropped, S, at('2026-08-11'), 'r1');
    expect(played.state.dropsTaken).toBe(0);
    expect(played.state.wiltedSince).toBeNull();
    // And the clock restarts from today: not even the wilt is due for another N days.
    expect(settlePlant(played.state, S, '2026-08-13').events).toEqual([]);
    expect(settlePlant(played.state, S, '2026-08-21').events.map((e) => e.type)).toEqual([
      'wilt',
      'decay_drop',
    ]);
  });
});

describe('applyHarvest()', () => {
  it('banks one fruit and starts a fresh seed', () => {
    const ripe = plant({ stage: MAX_STAGE, growCount: 2 });
    const t = ok(applyHarvest(ripe, S, at('2026-08-02')));
    expect(t.state.fruitsTotal).toBe(1);
    expect(t.state.stage).toBe(SEED_STAGE);
    expect(t.state.lastCareDay).toBe('2026-08-02');
    // The reset is not growth, so it does not spend the daily cap.
    expect(t.state.growCount).toBe(2);
    expect(t.events.at(-1)).toMatchObject({ type: 'harvest', refId: '1' });
  });

  it('refuses a second tap — a double submit banks one fruit, not two', () => {
    const t = ok(applyHarvest(plant({ stage: MAX_STAGE }), S, at('2026-08-02')));
    expect(applyHarvest(t.state, S, at('2026-08-02'))).toEqual({ error: 'not_ripe' });
    expect(t.state.fruitsTotal).toBe(1);
  });

  it('refuses an unripe plant, an empty pot and a dead one', () => {
    expect(applyHarvest(plant({ stage: 4 }), S, at('2026-08-02'))).toEqual({ error: 'not_ripe' });
    expect(applyHarvest(null, S, at('2026-08-02'))).toEqual({ error: 'not_ripe' });
    const dead = settlePlant(idleSince('2026-08-01', 1), S, '2026-08-11').state;
    expect(applyHarvest(dead, S, at('2026-08-11'))).toEqual({ error: 'dead' });
  });

  it('judges ripeness after settling, so a rotted fruit is no longer harvestable', () => {
    expect(applyHarvest(idleSince('2026-08-01', 5), S, at('2026-08-11'))).toEqual({
      error: 'not_ripe',
    });
  });

  it('attributes the fruit to the month it was tapped in', () => {
    const t = ok(applyHarvest(idleSince('2026-01-31', 5), S, at('2026-02-01')));
    expect(t.events.at(-1)).toMatchObject({ type: 'harvest', vnDay: '2026-02-01' });
  });
});

describe('applyWatering()', () => {
  it('adds a stage past the daily cap without refunding it', () => {
    // A student who has already used both of today's growths, the honest way.
    let state = applyQualifyingPlay(null, S, at('2026-08-05', '08:00'), 'r1').state;
    state = applyQualifyingPlay(state, S, at('2026-08-05', '09:00'), 'r2').state;
    expect(state.stage).toBe(2);

    const t = applyWatering(state, S, at('2026-08-05', '10:00'), 'staff-1', 'giỏi lắm');
    expect(t.state.stage).toBe(3);
    expect(t.state.growCount).toBe(2);
    expect(t.events.at(-1)).toMatchObject({
      type: 'water',
      actorStaffId: 'staff-1',
      note: 'giỏi lắm',
    });

    // The gift did not buy the student a third growth of their own.
    const play = applyQualifyingPlay(t.state, S, at('2026-08-05', '20:00'), 'r3');
    expect(play.state.stage).toBe(3);
  });

  it('clears the wilt and restarts the decay clock', () => {
    const wilted = settlePlant(idleSince('2026-08-01', 3), S, '2026-08-05').state;
    expect(wilted.wiltedSince).toBe('2026-08-04');

    const t = applyWatering(wilted, S, at('2026-08-05'), 'staff-1');
    expect(t.state.stage).toBe(4);
    expect(t.state.wiltedSince).toBeNull();
    expect(t.state.lastCareDay).toBe('2026-08-05');
    expect(t.state.dropsTaken).toBe(0);
  });

  it('clamps at fruit rather than auto-harvesting, but still logs and revives', () => {
    const t = applyWatering(
      plant({ stage: MAX_STAGE, wiltedSince: '2026-08-04' }),
      S,
      at('2026-08-05'),
      'staff-1',
    );
    expect(t.state.stage).toBe(MAX_STAGE);
    expect(t.state.fruitsTotal).toBe(0);
    expect(t.state.wiltedSince).toBeNull();
    expect(t.events.at(-1)).toMatchObject({ type: 'water', stageBefore: 5, stageAfter: 5 });
  });

  it('replants a dead plant, and plants for a student who has never played', () => {
    const dead = settlePlant(idleSince('2026-08-01', 1), S, '2026-08-11').state;
    const revived = applyWatering(dead, S, at('2026-08-11'), 'staff-1');
    expect(revived.state.stage).toBe(SEED_STAGE);
    expect(revived.state.isDead).toBe(false);
    expect(revived.events.at(-1)).toMatchObject({ stageBefore: 0, stageAfter: 1 });

    const fresh = applyWatering(null, S, at('2026-08-11'), 'staff-1');
    expect(fresh.state.stage).toBe(SEED_STAGE);
    expect(fresh.state.streakDays).toBe(0);
  });

  it('leaves the streak to the student', () => {
    const p = plant({ stage: 2, streakDays: 4, streakLastDay: '2026-08-01' });
    const t = applyWatering(p, S, at('2026-08-02'), 'staff-1');
    expect(t.state.streakDays).toBe(4);
    expect(t.state.streakLastDay).toBe('2026-08-01');
  });
});

describe('applyDeadlineCheck()', () => {
  it('costs a stage and shows the wilt', () => {
    const t = ok(applyDeadlineCheck(plant({ stage: 3 }), S, at('2026-08-02'), 'a1'));
    expect(t.state.stage).toBe(2);
    expect(t.state.wiltedSince).toBe('2026-08-02');
    expect(t.events.at(-1)).toMatchObject({ type: 'deadline_drop', refId: 'a1' });
  });

  it('never kills, and never touches the inactivity clock', () => {
    const t = ok(applyDeadlineCheck(plant({ stage: SEED_STAGE }), S, at('2026-08-02'), 'a1'));
    expect(t.state.stage).toBe(SEED_STAGE);
    expect(t.state.isDead).toBe(false);
    expect(t.state.lastCareDay).toBe('2026-08-01');
  });

  it('skips an empty pot and a dead plant', () => {
    expect(applyDeadlineCheck(null, S, at('2026-08-02'), 'a1')).toBeNull();
    const dead = settlePlant(idleSince('2026-08-01', 1), S, '2026-08-11').state;
    expect(applyDeadlineCheck(dead, S, at('2026-08-11'), 'a1')).toBeNull();
  });

  it('stacks with a decay drop that fell due the same day, without killing', () => {
    const t = ok(applyDeadlineCheck(idleSince('2026-08-01', 4), S, at('2026-08-11'), 'a1'));
    expect(types(t.events)).toEqual(['wilt', 'decay_drop', 'deadline_drop']);
    expect(t.state.stage).toBe(2);
  });
});

describe('plantView()', () => {
  it('renders an empty pot for a student who has never played', () => {
    const v = plantView(null, S, '2026-08-01');
    expect(v).toMatchObject({
      stage: 0,
      dead: false,
      wilted: false,
      streak: 0,
      harvestReady: false,
    });
    expect(v.growthLeftToday).toBe(2);
    expect(v.nextDropDate).toBeNull();
  });

  it('derives the wilt, the next drop and the harvest button', () => {
    const v = plantView(idleSince('2026-08-01', 5), S, '2026-08-05');
    expect(v.stage).toBe(5);
    expect(v.wilted).toBe(true);
    expect(v.wiltStartDate).toBe('2026-08-04');
    expect(v.nextDropDate).toBe('2026-08-11');
    expect(v.harvestReady).toBe(true);
    expect(v.daysIdle).toBe(4);
  });

  it('moves the next drop along as drops are taken', () => {
    expect(plantView(idleSince('2026-08-01', 5), S, '2026-08-11').nextDropDate).toBe('2026-08-18');
  });

  it('reports a dead plant with no further schedule', () => {
    const v = plantView(idleSince('2026-08-01', 1), S, '2026-08-20');
    expect(v).toMatchObject({ stage: 0, dead: true, wilted: false, nextDropDate: null });
  });

  it('counts the growth left today', () => {
    const a = applyQualifyingPlay(null, S, at('2026-08-01'), 'r1');
    expect(plantView(a.state, S, '2026-08-01').growthLeftToday).toBe(1);
    expect(plantView(a.state, S, '2026-08-02').growthLeftToday).toBe(2);
  });
});

describe('invariants', () => {
  it('keeps stage 0 and death in lockstep, and the event chain unbroken', () => {
    // A long, mixed history: plays, neglect, watering, harvest, a missed deadline.
    let state: PlantState | null = null;
    const chain: GardenEventDraft[] = [];
    const push = (t: PlantTransition) => {
      chain.push(...t.events);
      state = t.state;
    };

    push(applyQualifyingPlay(state, S, at('2026-08-01'), 'r1'));
    push(applyQualifyingPlay(state, S, at('2026-08-02'), 'r2'));
    push(applyWatering(state, S, at('2026-08-03'), 'staff-1'));
    push(applyQualifyingPlay(state, S, at('2026-08-04'), 'r3'));
    push(applyWatering(state, S, at('2026-08-05'), 'staff-1'));
    push(ok(applyHarvest(state, S, at('2026-08-05', '12:00'))));
    push(ok(applyDeadlineCheck(state, S, at('2026-08-06'), 'a1')));
    push(applyQualifyingPlay(state, S, at('2026-09-20'), 'r4'));

    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].stageBefore).toBe(chain[i - 1].stageAfter);
    }
    const final = state as unknown as PlantState;
    expect(final.fruitsTotal).toBe(1);
    expect(chain.filter((e) => e.type === 'harvest')).toHaveLength(1);
    expect(final.isDead).toBe(final.stage === 0);
    expect(final.stage).toBeGreaterThanOrEqual(0);
    expect(final.stage).toBeLessThanOrEqual(MAX_STAGE);
  });

  it('never grants more than the daily cap from play alone', () => {
    let state: PlantState | null = null;
    let grown = 0;
    for (let i = 0; i < 6; i++) {
      const t = applyQualifyingPlay(state, S, at('2026-08-01', `1${i}:00`), `r${i}`);
      grown += t.events.filter(
        (e) => (e.type === 'grow' || e.type === 'revive') && e.stageAfter > e.stageBefore,
      ).length;
      state = t.state;
    }
    expect(grown).toBe(S.dailyGrowthCap);
  });
});

describe('tallyGardenMonth', () => {
  /** One event row as the month rollup reads them. */
  const ev = (
    type: string,
    vnDay: string,
    stageBefore = 1,
    stageAfter = 2,
  ): { type: string; stageBefore: number; stageAfter: number; vnDay: string } => ({
    type,
    vnDay,
    stageBefore,
    stageAfter,
  });

  it('is all zeros for no events', () => {
    expect(tallyGardenMonth([])).toEqual(emptyMonthTally());
  });

  it('counts every qualifying play but only real growth', () => {
    // Three plays on one day under a cap of 2: the third is a `grow` row that gained nothing.
    const tally = tallyGardenMonth([
      ev('grow', '2026-08-03', 1, 2),
      ev('grow', '2026-08-03', 2, 3),
      ev('grow', '2026-08-03', 3, 3),
    ]);
    expect(tally.playDays).toBe(3);
    expect(tally.stagesGained).toBe(2);
    expect(tally.activeDays).toBe(1);
  });

  it('counts distinct ICT days as active days', () => {
    const tally = tallyGardenMonth([
      ev('grow', '2026-08-03'),
      ev('grow', '2026-08-03'),
      ev('grow', '2026-08-05'),
      ev('grow', '2026-08-11'),
    ]);
    expect(tally.activeDays).toBe(3);
    expect(tally.playDays).toBe(4);
  });

  it('counts harvests, and does not let a harvest reset look like growth', () => {
    // A harvest drops the plant from MAX_STAGE back to SEED_STAGE.
    const tally = tallyGardenMonth([ev('harvest', '2026-08-09', MAX_STAGE, SEED_STAGE)]);
    expect(tally.fruits).toBe(1);
    expect(tally.stagesGained).toBe(0);
    expect(tally.setbacks).toBe(0);
  });

  it('sums stages lost to neglect, a missed deadline and death', () => {
    const tally = tallyGardenMonth([
      ev('decay_drop', '2026-08-12', 4, 3),
      ev('deadline_drop', '2026-08-14', 3, 2),
      ev('die', '2026-08-20', 2, 0),
    ]);
    expect(tally.setbacks).toBe(4);
    expect(tally.playDays).toBe(0);
  });

  it('ignores event types that cost and gain nothing', () => {
    // `water` and `wilt` are real event types that must not move any of the five numbers.
    const tally = tallyGardenMonth([
      ev('water', '2026-08-04', 2, 2),
      ev('wilt', '2026-08-06', 2, 2),
    ]);
    expect(tally).toEqual(emptyMonthTally());
  });

  it('tells apart practice volume, habit and growth in one month', () => {
    const tally = tallyGardenMonth([
      ev('grow', '2026-08-01', 1, 2),
      ev('grow', '2026-08-01', 2, 3),
      ev('grow', '2026-08-01', 3, 3), // capped
      ev('grow', '2026-08-02', 3, 4),
      ev('grow', '2026-08-04', 4, 5),
      ev('harvest', '2026-08-04', 5, 1),
      ev('decay_drop', '2026-08-19', 1, 0),
    ]);
    expect(tally).toEqual({
      playDays: 5,
      activeDays: 3,
      stagesGained: 4,
      fruits: 1,
      setbacks: 1,
    });
  });
});
