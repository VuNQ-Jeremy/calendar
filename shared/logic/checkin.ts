/**
 * Check-in / check-out kiosk + túi mù maths.
 *
 * Pure functions only: no React, no Drizzle, no Date.now() — the same rule as garden.ts
 * and rankings.ts, and for the same reasons (mobile imports this, and time must not pass
 * differently on a phone set to Sydney). Callers supply every timestamp and date.
 *
 * The one deliberate derive-vs-store split lives here:
 *   - BAGS are a stored ledger (tui_mu_events). A bag is a moment — confetti fired, the
 *     kid saw "+1 túi mù" — and must survive an admin flipping earn mode mid-month or a
 *     teacher editing items after class. The unique (student_id, ref_id) index makes
 *     re-evaluation idempotent, exactly garden_events' refId pattern.
 *   - MISSES are derived at read time by tallyTuiMuMonth. A miss is a state description,
 *     not a moment: nothing is shown at miss time and no penalty attaches, so deriving
 *     keeps retroactive fixes honest (marking a kid excused later, or deleting a checklist
 *     authored for a session that never ran, makes the miss evaporate with no
 *     compensating-write machinery).
 */

export type CheckPhase = 'checkin' | 'checkout';
export type BagKind = CheckPhase | 'perfect';
export type EarnMode = 'perfect_day' | 'per_phase';

export interface CheckinTier {
  bags: number;
  label: string;
}

export interface CheckinSettings {
  earnMode: EarnMode;
  /** Ascending by bags; at most 5. */
  tiers: CheckinTier[];
  showClassBoard: boolean;
  showParentReport: boolean;
  showRankings: boolean;
  showStudentView: boolean;
}

export const CHECKIN_MAX_TIERS = 5;

export const DEFAULT_CHECKIN_SETTINGS: CheckinSettings = {
  earnMode: 'perfect_day',
  tiers: [
    { bags: 4, label: 'Quà nhỏ' },
    { bags: 8, label: 'Quà lớn' },
  ],
  showClassBoard: true,
  showParentReport: false,
  showRankings: false,
  showStudentView: true,
};

/** All cells ticked AND at least one cell exists — an empty list is never "complete". */
export function phaseComplete(itemCount: number, checkedCount: number): boolean {
  return itemCount > 0 && checkedCount >= itemCount;
}

/** The natural idempotency key a bag insert carries (unique per student via uq_tui_mu_ref). */
export function bagRefId(eventId: string, date: string, kind: BagKind): string {
  return `${eventId}:${date}:${kind}`;
}

/**
 * Which bag kinds to ATTEMPT inserting after completion state changed. Pure decision —
 * the service inserts with ON CONFLICT DO NOTHING, so attempting an already-earned kind
 * is harmless and this can be re-run on every tap.
 */
export function evaluateEarn(
  mode: EarnMode,
  status: { checkinComplete: boolean; checkoutComplete: boolean },
): BagKind[] {
  if (mode === 'per_phase') {
    const kinds: BagKind[] = [];
    if (status.checkinComplete) kinds.push('checkin');
    if (status.checkoutComplete) kinds.push('checkout');
    return kinds;
  }
  return status.checkinComplete && status.checkoutComplete ? ['perfect'] : [];
}

/**
 * One student's one occurrence, pre-joined by the service. `sessionRan` is the service's
 * heuristic for "this session actually happened" — there is no occurrence-cancellation
 * concept in the schema, so a checklist authored for a cancelled session must not mint
 * misses: EXISTS(any attendance row for the occurrence) OR EXISTS(any check by anyone).
 */
export interface SessionOutcome {
  date: string;
  /** Check-in items existed for the occurrence. */
  hadCheckin: boolean;
  sessionRan: boolean;
  checkinDone: number;
  checkinTotal: number;
  /** attendance_records.status, or null when unmarked. */
  attendanceStatus: string | null;
  /** Stored ledger kinds for this student + occurrence. */
  bagKinds: ReadonlySet<BagKind>;
}

export interface TuiMuMonthTally {
  /** Ledger count, month-scoped by vn_day — the ONLY stored quantity here. */
  bags: number;
  misses: number;
  fullCheckins: number;
  /** Consecutive trailing counted sessions (date order) with a full check-in. */
  streak: number;
  /** Sessions counted: hadCheckin && sessionRan && not excused. */
  sessions: number;
}

/** Was the check-in full for this outcome? The ledger wins over later item edits. */
function checkinFull(s: SessionOutcome): boolean {
  if (s.bagKinds.has('checkin') || s.bagKinds.has('perfect')) return true;
  return phaseComplete(s.checkinTotal, s.checkinDone);
}

/**
 * Fold one student's month. Rules, per session, in order:
 *   1. skipped unless hadCheckin && sessionRan (no checklist / cancelled session → not counted);
 *   2. attendanceStatus === 'excused' → exempt entirely (rankings' own treatment of excused —
 *      an approved absence is not a mark against the kid);
 *   3. a stored 'checkin'/'perfect' bag → full, never a miss, even if later edits made the
 *      checklist look incomplete;
 *   4. all items checked → full;
 *   5. otherwise — including zero checks, i.e. plain absence — one miss.
 */
export function tallyTuiMuMonth(sessions: SessionOutcome[], bagCount: number): TuiMuMonthTally {
  const counted = sessions
    .filter((s) => s.hadCheckin && s.sessionRan && s.attendanceStatus !== 'excused')
    .sort((a, b) => a.date.localeCompare(b.date));

  let misses = 0;
  let fullCheckins = 0;
  let streak = 0;
  for (const s of counted) {
    if (checkinFull(s)) {
      fullCheckins += 1;
      streak += 1;
    } else {
      misses += 1;
      streak = 0;
    }
  }

  return { bags: bagCount, misses, fullCheckins, streak, sessions: counted.length };
}

/** Highest tier already reached, or null. Tiers must be ascending by bags. */
export function qualifiedTier(bags: number, tiers: CheckinTier[]): CheckinTier | null {
  let best: CheckinTier | null = null;
  for (const t of tiers) {
    if (bags >= t.bags && (best == null || t.bags > best.bags)) best = t;
  }
  return best;
}

/**
 * Rankings ý thức component: ratio of full check-ins over counted sessions, × 10, 1dp.
 * Null when the month has no counted sessions — excluded from the attitude mean like the
 * other components, so a class that never runs check-in ranks exactly as before.
 */
export function checkinComponent(t: TuiMuMonthTally | null | undefined): number | null {
  if (!t || t.sessions === 0) return null;
  return Math.round((t.fullCheckins / t.sessions) * 100) / 10;
}

/**
 * Where "check-in buổi sau" items are written: the next occurrence of this event.
 * Mirrors how the calendar expands recurrence — weekly → +7 ICT days, daily → +1;
 * one-off events have no next occurrence, so the authoring section hides.
 */
export function nextOccurrenceDate(
  recurrence: string | null | undefined,
  date: string,
): string | null {
  if (recurrence === 'weekly') return addDaysIct(date, 7);
  if (recurrence === 'daily') return addDaysIct(date, 1);
  return null;
}

// Local ICT day arithmetic (garden.ts has identical helpers, but importing garden's would
// couple two unrelated features for three lines of epoch maths).
function addDaysIct(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}
