import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHECKIN_SETTINGS,
  bagRefId,
  checkinComponent,
  deadlineInVocabWindow,
  evaluateEarn,
  nextOccurrenceDate,
  phaseComplete,
  prevOccurrenceDate,
  qualifiedTier,
  tallyTuiMuMonth,
  vocabSquareMet,
  type BagKind,
  type SessionOutcome,
} from '../shared/logic/checkin.js';

function outcome(over: Partial<SessionOutcome> = {}): SessionOutcome {
  return {
    date: '2026-08-03',
    hadCheckin: true,
    sessionRan: true,
    checkinDone: 3,
    checkinTotal: 3,
    attendanceStatus: 'present',
    bagKinds: new Set<BagKind>(),
    ...over,
  };
}

describe('phaseComplete', () => {
  it('requires at least one item', () => {
    expect(phaseComplete(0, 0)).toBe(false);
  });
  it('all checked → complete; one short → not', () => {
    expect(phaseComplete(3, 3)).toBe(true);
    expect(phaseComplete(3, 2)).toBe(false);
  });
});

describe('evaluateEarn', () => {
  it('perfect_day awards only when BOTH phases are complete', () => {
    expect(evaluateEarn('perfect_day', { checkinComplete: true, checkoutComplete: false })).toEqual(
      [],
    );
    expect(evaluateEarn('perfect_day', { checkinComplete: true, checkoutComplete: true })).toEqual([
      'perfect',
    ]);
  });
  it('per_phase awards each phase independently', () => {
    expect(evaluateEarn('per_phase', { checkinComplete: true, checkoutComplete: false })).toEqual([
      'checkin',
    ]);
    expect(evaluateEarn('per_phase', { checkinComplete: true, checkoutComplete: true })).toEqual([
      'checkin',
      'checkout',
    ]);
    expect(evaluateEarn('per_phase', { checkinComplete: false, checkoutComplete: false })).toEqual(
      [],
    );
  });
});

describe('bagRefId', () => {
  it('is stable per (event, date, kind) — the idempotency key', () => {
    expect(bagRefId('ev1', '2026-08-03', 'perfect')).toBe('ev1:2026-08-03:perfect');
  });
});

describe('tallyTuiMuMonth', () => {
  it('counts a full month: fulls, misses, streak resets', () => {
    const t = tallyTuiMuMonth(
      [
        outcome({ date: '2026-08-03' }),
        outcome({ date: '2026-08-10', checkinDone: 1 }), // miss
        outcome({ date: '2026-08-17' }),
        outcome({ date: '2026-08-24' }),
      ],
      3,
    );
    expect(t).toEqual({ bags: 3, misses: 1, fullCheckins: 3, streak: 2, sessions: 4 });
  });

  it('absence (zero checks) is a miss', () => {
    const t = tallyTuiMuMonth([outcome({ checkinDone: 0, attendanceStatus: 'absent' })], 0);
    expect(t.misses).toBe(1);
  });

  it('excused is exempt — not a session, not a miss', () => {
    const t = tallyTuiMuMonth([outcome({ checkinDone: 0, attendanceStatus: 'excused' })], 0);
    expect(t).toEqual({ bags: 0, misses: 0, fullCheckins: 0, streak: 0, sessions: 0 });
  });

  it('skips occurrences with no checklist or that never ran', () => {
    const t = tallyTuiMuMonth(
      [
        outcome({ hadCheckin: false }),
        outcome({ sessionRan: false, checkinDone: 0, attendanceStatus: null }),
      ],
      0,
    );
    expect(t.sessions).toBe(0);
    expect(t.misses).toBe(0);
  });

  it('a stored bag wins over later item edits — never a miss', () => {
    const t = tallyTuiMuMonth(
      [outcome({ checkinDone: 3, checkinTotal: 4, bagKinds: new Set<BagKind>(['checkin']) })],
      1,
    );
    expect(t.misses).toBe(0);
    expect(t.fullCheckins).toBe(1);
  });

  it('sorts by date before computing the trailing streak', () => {
    const t = tallyTuiMuMonth(
      [
        outcome({ date: '2026-08-17' }),
        outcome({ date: '2026-08-03', checkinDone: 0, attendanceStatus: 'absent' }),
        outcome({ date: '2026-08-10' }),
      ],
      0,
    );
    expect(t.streak).toBe(2);
  });
});

describe('qualifiedTier', () => {
  const tiers = DEFAULT_CHECKIN_SETTINGS.tiers; // 4 → Quà nhỏ, 8 → Quà lớn
  it('picks the highest reached tier', () => {
    expect(qualifiedTier(3, tiers)).toBeNull();
    expect(qualifiedTier(4, tiers)?.label).toBe('Quà nhỏ');
    expect(qualifiedTier(9, tiers)?.label).toBe('Quà lớn');
  });
  it('empty tiers → null', () => {
    expect(qualifiedTier(99, [])).toBeNull();
  });
});

describe('checkinComponent', () => {
  it('null with no tally or no counted sessions', () => {
    expect(checkinComponent(null)).toBeNull();
    expect(
      checkinComponent({ bags: 0, misses: 0, fullCheckins: 0, streak: 0, sessions: 0 }),
    ).toBeNull();
  });
  it('ratio × 10, one decimal', () => {
    expect(checkinComponent({ bags: 0, misses: 1, fullCheckins: 2, streak: 0, sessions: 3 })).toBe(
      6.7,
    );
  });
});

describe('nextOccurrenceDate', () => {
  it('weekly → +7 ICT days, daily → +1, one-off → null', () => {
    expect(nextOccurrenceDate('weekly', '2026-08-28')).toBe('2026-09-04');
    expect(nextOccurrenceDate('daily', '2026-08-31')).toBe('2026-09-01');
    expect(nextOccurrenceDate('none', '2026-08-28')).toBeNull();
    expect(nextOccurrenceDate(null, '2026-08-28')).toBeNull();
  });
});

describe('prevOccurrenceDate', () => {
  it('weekly steps back 7 ICT days, daily 1, one-off null', () => {
    expect(prevOccurrenceDate('weekly', '2026-08-23')).toBe('2026-08-16');
    expect(prevOccurrenceDate('daily', '2026-08-23')).toBe('2026-08-22');
    expect(prevOccurrenceDate('none', '2026-08-23')).toBeNull();
    expect(prevOccurrenceDate(null, '2026-08-23')).toBeNull();
  });
  it('crosses month boundaries', () => {
    expect(prevOccurrenceDate('weekly', '2026-09-03')).toBe('2026-08-27');
  });
});

describe('deadlineInVocabWindow', () => {
  it('is (prev, date] — exclusive at the previous session, inclusive today', () => {
    expect(deadlineInVocabWindow('2026-08-16', '2026-08-16', '2026-08-23')).toBe(false);
    expect(deadlineInVocabWindow('2026-08-17', '2026-08-16', '2026-08-23')).toBe(true);
    expect(deadlineInVocabWindow('2026-08-23', '2026-08-16', '2026-08-23')).toBe(true);
    expect(deadlineInVocabWindow('2026-08-24', '2026-08-16', '2026-08-23')).toBe(false);
  });
  it('null prev (one-off event) degrades to deadline === date, never open-ended', () => {
    expect(deadlineInVocabWindow('2026-08-23', null, '2026-08-23')).toBe(true);
    expect(deadlineInVocabWindow('2026-08-22', null, '2026-08-23')).toBe(false);
  });
});

describe('vocabSquareMet', () => {
  it('all assignments met', () => {
    expect(
      vocabSquareMet([
        { done: 3, requiredCount: 3 },
        { done: 5, requiredCount: 2 },
      ]),
    ).toBe(true);
  });
  it('one short → not met', () => {
    expect(
      vocabSquareMet([
        { done: 3, requiredCount: 3 },
        { done: 1, requiredCount: 2 },
      ]),
    ).toBe(false);
  });
  it('zero applicable assignments is vacuously met (fully narrowed-away student)', () => {
    expect(vocabSquareMet([])).toBe(true);
  });
});
