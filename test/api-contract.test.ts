import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as c from '../shared/api-contract';
import type {
  GardenOutcome,
  GardenSettings,
  GardenSnapshotData,
  PlantView,
} from '../shared/logic/garden';
import type { GardenMonthSummary } from '../server/services/garden';
import type { StudentFee } from '../shared/logic/fees';
import type { TuiMuMonthTally } from '../shared/logic/checkin';
import type { AuthLevel } from '../server/api/handler';
import type { DocAuthLevel } from '../server/api/docs/types';

/**
 * Drift checks for `shared/api-contract.ts`.
 *
 * Its counterpart is `mobile/lib/contract-check.ts`, which covers the shapes the phone types by
 * hand. This file covers the ones that come from `shared/logic/*` instead — those are in the root
 * tsconfig, so `npm run typecheck` sees them, whereas mobile/ has its own tsconfig and is only
 * checked by `cd mobile && npx tsc --noEmit`. Between the two files every response shape has a
 * compile-time anchor to something that already existed.
 *
 * The assertions below are types, not runtime expressions: they fail `npm run typecheck` rather
 * than this suite. The `it()` blocks exist so the schemas are also exercised at runtime, which is
 * what catches a schema that describes the right TypeScript type but rejects a real payload.
 */
type Extends<A, B> = A extends B ? true : false;
type Expect<T extends true> = T;
type Infer<S> = S extends z.ZodType ? z.infer<S> : never;

type _PlantView = Expect<Extends<Infer<typeof c.PlantView>, PlantView>>;
type _GardenSettings = Expect<Extends<Infer<typeof c.GardenSettings>, GardenSettings>>;
type _GardenOutcome = Expect<Extends<Infer<typeof c.GardenOutcome>, GardenOutcome>>;
type _GardenSnapshotData = Expect<Extends<Infer<typeof c.GardenSnapshotData>, GardenSnapshotData>>;
// This one is anchored against the SERVICE's own return type rather than a shared/logic type —
// it is assembled in server/services/garden.ts. It also covers the month tally it folds in,
// which is deliberately not a component of its own.
type _GardenMonthSummary = Expect<Extends<Infer<typeof c.GardenMonthSummary>, GardenMonthSummary>>;
type _StudentFee = Expect<Extends<Infer<typeof c.StudentFee>, StudentFee>>;
type _TuiMuMonthTally = Expect<Extends<Infer<typeof c.TuiMuMonthTally>, TuiMuMonthTally>>;

/**
 * `server/api/docs/types.ts` restates `AuthLevel` instead of importing it, so that the registry
 * stays loadable outside the Worker. This is what keeps the copy honest: every real level must
 * still be a documentable one.
 */
type _AuthLevelsCovered = Expect<Extends<AuthLevel, DocAuthLevel>>;

describe('response schemas accept real payloads', () => {
  it('parses a plant view', () => {
    const plant: PlantView = {
      stage: 3,
      wilted: false,
      dead: false,
      streak: 4,
      fruitsTotal: 2,
      daysIdle: 0,
      wiltStartDate: null,
      nextDropDate: '2026-08-20',
      harvestReady: false,
      growthLeftToday: 1,
      titleId: null,
    };
    expect(c.PlantView.parse(plant)).toMatchObject({ stage: 3, streak: 4 });
  });

  it('parses an event row', () => {
    const row = {
      id: 'e1',
      title: 'Lớp 5A',
      date: '2026-08-14',
      start: '18:00',
      end: '19:30',
      color: 'violet',
      classId: 'c1',
      location: null,
      recurrence: 'weekly',
      notes: null,
    };
    expect(c.EventRow.parse(row)).toMatchObject({ id: 'e1', recurrence: 'weekly' });
  });

  it('rejects a row missing its id', () => {
    expect(c.EventRow.safeParse({ title: 'x', date: '2026-08-14' }).success).toBe(false);
  });

  it('parses the zeroed fee slip the tuition endpoint falls back to', () => {
    const zero: StudentFee = {
      studentId: 's1',
      lines: [],
      billedVnd: 0,
      adjustmentVnd: 0,
      adjustmentNote: null,
      dueVnd: 0,
      paidVnd: 0,
      paidAt: null,
      paymentNote: null,
      outstandingVnd: 0,
      status: 'paid',
    };
    expect(c.StudentFee.parse(zero).status).toBe('paid');
  });

  it('accepts both halves of the check-in union', () => {
    expect(c.CheckinSummary.safeParse({ disabled: true }).success).toBe(true);
    expect(
      c.CheckinSummary.safeParse({
        disabled: false,
        month: '2026-08',
        tally: { bags: 3, misses: 1, fullCheckins: 3, streak: 2, sessions: 4 },
        tier: { bags: 3, label: 'Bạc' },
      }).success,
    ).toBe(true);
  });
});

describe('registration', () => {
  it('gives every exported schema a meta id matching its export name', () => {
    // The ids are what `build-spec.ts` keys `components.schemas` on, so a mismatch would emit a
    // component under a name nothing refers to.
    const wrong: string[] = [];
    for (const [name, schema] of Object.entries(c)) {
      const meta = (schema as z.ZodType).meta?.() as { id?: string } | undefined;
      if (meta?.id !== name) wrong.push(`${name} -> ${String(meta?.id)}`);
    }
    expect(wrong).toEqual([]);
  });
});
