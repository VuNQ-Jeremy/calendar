import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  attendanceRecords,
  checkinActivityTypes,
  checklistChecks,
  checklistItems,
  classStudents,
  events,
  giftRedemptions,
  settings,
  tuiMuEvents,
} from '../db/schema';
import type { Db } from '../db/index';
import type { CheckInput, ChecklistItemInput, GiftRedeemInput } from '../../shared/schemas';
import {
  DEFAULT_CHECKIN_SETTINGS,
  bagRefId,
  evaluateEarn,
  phaseComplete,
  tallyTuiMuMonth,
  type BagKind,
  type CheckPhase,
  type CheckinSettings,
  type SessionOutcome,
  type TuiMuMonthTally,
} from '../../shared/logic/checkin';
import { record, recordCreate, recordDelete } from './audit';
import { markPresentIfUnmarked } from './attendance';
import { list as listActivityTypes, type ActivityTypeRow } from './checkin-activity-types';

const SETTINGS_KEY = 'checkin-settings';

// ---- Settings ----

/** Same store and defaulting shape as `getGardenSettings`: validate, else fall back whole. */
export async function getCheckinSettings(db: Db): Promise<CheckinSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY));
  const row = rows[0];
  if (!row) return structuredClone(DEFAULT_CHECKIN_SETTINGS);
  try {
    const parsed = JSON.parse(row.value) as Partial<CheckinSettings>;
    const merged = { ...structuredClone(DEFAULT_CHECKIN_SETTINGS), ...parsed };
    const sane =
      (merged.earnMode === 'perfect_day' || merged.earnMode === 'per_phase') &&
      Array.isArray(merged.tiers) &&
      merged.tiers.length <= 5 &&
      merged.tiers.every(
        (t) =>
          Number.isInteger(t?.bags) && t.bags >= 1 && t.bags <= 60 && typeof t?.label === 'string',
      ) &&
      [
        merged.showClassBoard,
        merged.showParentReport,
        merged.showRankings,
        merged.showStudentView,
      ].every((b) => typeof b === 'boolean');
    return sane ? merged : structuredClone(DEFAULT_CHECKIN_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_CHECKIN_SETTINGS);
  }
}

export async function setCheckinSettings(db: Db, input: CheckinSettings): Promise<CheckinSettings> {
  const before = await getCheckinSettings(db);
  const stored: CheckinSettings = {
    ...input,
    // Ascending by bags — qualifiedTier and the tier editor both rely on it.
    tiers: [...input.tiers].sort((a, b) => a.bags - b.bags),
  };
  const value = JSON.stringify(stored);
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  record({
    action: 'update',
    entityType: 'setting',
    entityId: SETTINGS_KEY,
    before,
    after: stored,
  });
  return stored;
}

// ---- Checklist items ----

export type ChecklistItemRow = {
  id: string;
  eventId: string;
  date: string;
  phase: CheckPhase;
  activityTypeId: string | null;
  label: string;
  sortOrder: number;
};

export type CheckRow = { itemId: string; studentId: string; checkedAt: string };

function mapItem(r: typeof checklistItems.$inferSelect): ChecklistItemRow {
  return {
    id: r.id,
    eventId: r.eventId,
    date: r.date,
    phase: r.phase as CheckPhase,
    activityTypeId: r.activityTypeId,
    label: r.label,
    sortOrder: r.sortOrder,
  };
}

async function itemsForOccurrence(
  db: Db,
  eventId: string,
  date: string,
): Promise<ChecklistItemRow[]> {
  const rows = await db
    .select()
    .from(checklistItems)
    .where(and(eq(checklistItems.eventId, eventId), eq(checklistItems.date, date)))
    .orderBy(asc(checklistItems.phase), asc(checklistItems.sortOrder));
  return rows.map(mapItem);
}

async function checksForItems(db: Db, itemIds: string[]): Promise<CheckRow[]> {
  if (!itemIds.length) return [];
  const rows = await db
    .select()
    .from(checklistChecks)
    .where(inArray(checklistChecks.itemId, itemIds));
  return rows.map((r) => ({ itemId: r.itemId, studentId: r.studentId, checkedAt: r.checkedAt }));
}

/** Everything the authoring tab and the kiosk need for one occurrence, both phases. */
export async function getOccurrence(
  db: Db,
  eventId: string,
  date: string,
): Promise<{ items: ChecklistItemRow[]; checks: CheckRow[]; activityTypes: ActivityTypeRow[] }> {
  const items = await itemsForOccurrence(db, eventId, date);
  const [checks, types] = await Promise.all([
    checksForItems(
      db,
      items.map((i) => i.id),
    ),
    listActivityTypes(db),
  ]);
  return { items, checks, activityTypes: types.filter((t) => t.active) };
}

export async function createItem(
  db: Db,
  input: ChecklistItemInput,
  staffId: string,
  nowUtcIso: string,
): Promise<ChecklistItemRow> {
  const id = crypto.randomUUID();
  let sortOrder = input.sortOrder ?? undefined;
  if (sortOrder == null) {
    const existing = await itemsForOccurrence(db, input.eventId, input.date);
    sortOrder =
      existing
        .filter((i) => i.phase === input.phase)
        .reduce((m, i) => Math.max(m, i.sortOrder), 0) + 1;
  }
  await db.insert(checklistItems).values({
    id,
    eventId: input.eventId,
    date: input.date,
    phase: input.phase,
    activityTypeId: input.activityTypeId ?? null,
    label: input.label,
    sortOrder,
    createdBy: staffId,
    createdAt: nowUtcIso,
  });
  const rows = await db.select().from(checklistItems).where(eq(checklistItems.id, id));
  const row = mapItem(rows[0]);
  recordCreate('checklist_item', id, row);
  return row;
}

export async function updateItem(
  db: Db,
  id: string,
  patch: { activityTypeId?: string | null; label?: string },
): Promise<ChecklistItemRow | null> {
  const beforeRows = await db.select().from(checklistItems).where(eq(checklistItems.id, id));
  if (!beforeRows[0]) return null;
  const before = mapItem(beforeRows[0]);
  const set: Partial<typeof checklistItems.$inferInsert> = {};
  if (patch.activityTypeId !== undefined) set.activityTypeId = patch.activityTypeId;
  if (patch.label !== undefined) set.label = patch.label;
  if (Object.keys(set).length) {
    await db.update(checklistItems).set(set).where(eq(checklistItems.id, id));
  }
  const rows = await db.select().from(checklistItems).where(eq(checklistItems.id, id));
  const after = mapItem(rows[0]);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    record({ action: 'update', entityType: 'checklist_item', entityId: id, before, after });
  }
  return after;
}

/** Checks cascade with the item — a removed cell takes its taps with it, and tallies self-correct. */
export async function deleteItem(db: Db, id: string): Promise<void> {
  await recordDelete(db, 'checklist_item', checklistItems, id);
  await db.delete(checklistItems).where(eq(checklistItems.id, id));
}

export async function reorderItems(db: Db, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db
      .update(checklistItems)
      .set({ sortOrder: i + 1 })
      .where(eq(checklistItems.id, ids[i]));
  }
  record({ action: 'update', entityType: 'checklist_item', meta: { reordered: ids } });
}

// ---- The kiosk write ----

/**
 * One kiosk tap. Sequence:
 *   1. toggle the check (PK upsert / delete — both idempotent);
 *   2. check-in taps auto-mark the student present (insert-only-if-unmarked; a teacher's
 *      'late'/'excused' always wins);
 *   3. re-read both phases' completion and ATTEMPT the earned bag inserts — the unique
 *      (student_id, ref_id) index makes re-attempts no-ops, so this runs on every tap.
 * Bags are never revoked on uncheck: the ledger is append-only, and the miss derivation
 * treats a stored bag as full (see shared/logic/checkin.ts).
 */
export async function setCheck(
  db: Db,
  input: CheckInput,
  nowUtcIso: string,
): Promise<{
  checks: CheckRow[];
  awarded: BagKind[];
  attendanceMarked: boolean;
} | null> {
  const itemRows = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.id, input.itemId));
  const item = itemRows[0] ? mapItem(itemRows[0]) : null;
  if (!item) return null;

  if (input.checked) {
    await db
      .insert(checklistChecks)
      .values({ itemId: item.id, studentId: input.studentId, checkedAt: nowUtcIso })
      .onConflictDoNothing();
  } else {
    await db
      .delete(checklistChecks)
      .where(
        and(eq(checklistChecks.itemId, item.id), eq(checklistChecks.studentId, input.studentId)),
      );
  }

  let attendanceMarked = false;
  if (item.phase === 'checkin' && input.checked) {
    attendanceMarked = await markPresentIfUnmarked(db, item.eventId, item.date, input.studentId);
  }

  const items = await itemsForOccurrence(db, item.eventId, item.date);
  const checks = await checksForItems(
    db,
    items.map((i) => i.id),
  );
  const mine = new Set(checks.filter((c) => c.studentId === input.studentId).map((c) => c.itemId));
  const phaseCounts = (phase: CheckPhase) => {
    const ids = items.filter((i) => i.phase === phase).map((i) => i.id);
    return { total: ids.length, done: ids.filter((id) => mine.has(id)).length };
  };
  const ci = phaseCounts('checkin');
  const co = phaseCounts('checkout');

  const cfg = await getCheckinSettings(db);
  const kinds = evaluateEarn(cfg.earnMode, {
    checkinComplete: phaseComplete(ci.total, ci.done),
    checkoutComplete: phaseComplete(co.total, co.done),
  });

  const awarded: BagKind[] = [];
  if (kinds.length) {
    const refIds = kinds.map((k) => bagRefId(item.eventId, item.date, k));
    const existing = await db
      .select()
      .from(tuiMuEvents)
      .where(and(eq(tuiMuEvents.studentId, input.studentId), inArray(tuiMuEvents.refId, refIds)));
    const have = new Set(existing.map((r) => r.refId));
    const eventRows = await db
      .select({ classId: events.classId })
      .from(events)
      .where(eq(events.id, item.eventId));
    for (const kind of kinds) {
      const refId = bagRefId(item.eventId, item.date, kind);
      if (have.has(refId)) continue;
      await db
        .insert(tuiMuEvents)
        .values({
          id: crypto.randomUUID(),
          studentId: input.studentId,
          classId: eventRows[0]?.classId ?? null,
          vnDay: item.date,
          kind,
          refId,
          createdAt: nowUtcIso,
        })
        .onConflictDoNothing();
      awarded.push(kind);
    }
  }

  // High-frequency write: one compact meta'd entry, never before/after blobs.
  record({
    action: 'update',
    entityType: 'checklist_check',
    entityId: item.id,
    meta: { studentId: input.studentId, checked: input.checked, awarded },
  });

  return { checks, awarded, attendanceMarked };
}

// ---- Teacher flag view ----

export type OccurrenceFlags = {
  studentId: string;
  uncheckedCheckin: string[];
  uncheckedCheckout: string[];
}[];

/** Per-student unchecked item ids for one occurrence — the "chưa tự tin" panel. */
export async function occurrenceFlags(
  db: Db,
  eventId: string,
  date: string,
  rosterIds: string[],
): Promise<OccurrenceFlags> {
  const items = await itemsForOccurrence(db, eventId, date);
  const checks = await checksForItems(
    db,
    items.map((i) => i.id),
  );
  const byStudent = new Map<string, Set<string>>();
  for (const c of checks) {
    let s = byStudent.get(c.studentId);
    if (!s) byStudent.set(c.studentId, (s = new Set()));
    s.add(c.itemId);
  }
  return rosterIds.map((studentId) => {
    const mine = byStudent.get(studentId) ?? new Set<string>();
    return {
      studentId,
      uncheckedCheckin: items
        .filter((i) => i.phase === 'checkin' && !mine.has(i.id))
        .map((i) => i.id),
      uncheckedCheckout: items
        .filter((i) => i.phase === 'checkout' && !mine.has(i.id))
        .map((i) => i.id),
    };
  });
}

// ---- Month tallies (derived; only bags come from the ledger) ----

type OccurrenceData = {
  eventId: string;
  date: string;
  checkinItemIds: string[];
  hadAnyCheck: boolean;
  hadAttendance: boolean;
};

/**
 * Shared assembly for the class board / report / rankings feeds. Month range is the
 * project convention `${month}-01`..`${month}-31`, compared lexically.
 */
async function monthOccurrences(
  db: Db,
  eventIds: string[],
  month: string,
): Promise<{ occurrences: OccurrenceData[]; checks: CheckRow[]; attendance: Map<string, string> }> {
  if (!eventIds.length) return { occurrences: [], checks: [], attendance: new Map() };
  const itemRows = await db
    .select()
    .from(checklistItems)
    .where(
      and(
        inArray(checklistItems.eventId, eventIds),
        gte(checklistItems.date, `${month}-01`),
        lte(checklistItems.date, `${month}-31`),
      ),
    );
  const items = itemRows.map(mapItem);
  const checks = await checksForItems(
    db,
    items.map((i) => i.id),
  );
  const checkedItemIds = new Set(checks.map((c) => c.itemId));

  const attRows = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        inArray(attendanceRecords.eventId, eventIds),
        gte(attendanceRecords.date, `${month}-01`),
        lte(attendanceRecords.date, `${month}-31`),
      ),
    );
  // Key "eventId:date:studentId" -> status; also collect which occurrences have ANY row.
  const attendance = new Map<string, string>();
  const attOccurrences = new Set<string>();
  for (const r of attRows) {
    attendance.set(`${r.eventId}:${r.date}:${r.studentId}`, r.status);
    attOccurrences.add(`${r.eventId}:${r.date}`);
  }

  const byOcc = new Map<string, OccurrenceData>();
  for (const i of items) {
    const key = `${i.eventId}:${i.date}`;
    let occ = byOcc.get(key);
    if (!occ) {
      byOcc.set(
        key,
        (occ = {
          eventId: i.eventId,
          date: i.date,
          checkinItemIds: [],
          hadAnyCheck: false,
          hadAttendance: attOccurrences.has(key),
        }),
      );
    }
    if (i.phase === 'checkin') occ.checkinItemIds.push(i.id);
    if (checkedItemIds.has(i.id)) occ.hadAnyCheck = true;
  }
  return { occurrences: [...byOcc.values()], checks, attendance };
}

function outcomesFor(
  studentId: string,
  occurrences: OccurrenceData[],
  checks: CheckRow[],
  attendance: Map<string, string>,
  bagsByStudent: Map<string, { vnDay: string; kind: string; refId: string }[]>,
): SessionOutcome[] {
  const mine = new Set(checks.filter((c) => c.studentId === studentId).map((c) => c.itemId));
  const myBags = bagsByStudent.get(studentId) ?? [];
  return occurrences.map((occ) => {
    const prefix = `${occ.eventId}:${occ.date}:`;
    const bagKinds = new Set(
      myBags.filter((b) => b.refId.startsWith(prefix)).map((b) => b.kind as BagKind),
    );
    return {
      date: occ.date,
      hadCheckin: occ.checkinItemIds.length > 0,
      // "The session actually happened": someone was marked, or someone tapped something.
      sessionRan: occ.hadAttendance || occ.hadAnyCheck,
      checkinDone: occ.checkinItemIds.filter((id) => mine.has(id)).length,
      checkinTotal: occ.checkinItemIds.length,
      attendanceStatus: attendance.get(`${occ.eventId}:${occ.date}:${studentId}`) ?? null,
      bagKinds,
    };
  });
}

async function bagsForMonth(
  db: Db,
  studentIds: string[],
  month: string,
): Promise<Map<string, { vnDay: string; kind: string; refId: string }[]>> {
  const map = new Map<string, { vnDay: string; kind: string; refId: string }[]>();
  if (!studentIds.length) return map;
  const rows = await db
    .select()
    .from(tuiMuEvents)
    .where(
      and(
        inArray(tuiMuEvents.studentId, studentIds),
        gte(tuiMuEvents.vnDay, `${month}-01`),
        lte(tuiMuEvents.vnDay, `${month}-31`),
      ),
    );
  for (const r of rows) {
    let list = map.get(r.studentId);
    if (!list) map.set(r.studentId, (list = []));
    list.push({ vnDay: r.vnDay, kind: r.kind, refId: r.refId });
  }
  return map;
}

/**
 * Month tallies for every rostered student of a class. Bags are counted school-wide for the
 * month (a bag is a bag — the monthly gift is per student, not per class); sessions and
 * misses are scoped to this class's occurrences. Bounded: ~16 occurrences × ~15 kids.
 */
export async function classMonthTallies(
  db: Db,
  classId: string,
  month: string,
): Promise<Map<string, TuiMuMonthTally>> {
  const eventRows = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.classId, classId));
  const rosterRows = await db
    .select({ studentId: classStudents.studentId })
    .from(classStudents)
    .where(eq(classStudents.classId, classId));
  const rosterIds = rosterRows.map((r) => r.studentId);

  const { occurrences, checks, attendance } = await monthOccurrences(
    db,
    eventRows.map((e) => e.id),
    month,
  );
  const bags = await bagsForMonth(db, rosterIds, month);

  const out = new Map<string, TuiMuMonthTally>();
  for (const studentId of rosterIds) {
    out.set(
      studentId,
      tallyTuiMuMonth(
        outcomesFor(studentId, occurrences, checks, attendance, bags),
        bags.get(studentId)?.length ?? 0,
      ),
    );
  }
  return out;
}

/** One student across all their classes — the report / parent / student-view feed. */
export async function studentMonthTally(
  db: Db,
  studentId: string,
  month: string,
): Promise<TuiMuMonthTally> {
  const classRows = await db
    .select({ classId: classStudents.classId })
    .from(classStudents)
    .where(eq(classStudents.studentId, studentId));
  const classIds = classRows.map((r) => r.classId);
  const eventRows = classIds.length
    ? await db.select({ id: events.id }).from(events).where(inArray(events.classId, classIds))
    : [];
  const { occurrences, checks, attendance } = await monthOccurrences(
    db,
    eventRows.map((e) => e.id),
    month,
  );
  const bags = await bagsForMonth(db, [studentId], month);
  return tallyTuiMuMonth(
    outcomesFor(studentId, occurrences, checks, attendance, bags),
    bags.get(studentId)?.length ?? 0,
  );
}

// ---- Gift redemptions ----

export type GiftRedemptionRow = {
  id: string;
  studentId: string;
  month: string;
  tierBags: number;
  label: string | null;
  staffId: string | null;
  note: string | null;
  createdAt: string;
};

function mapRedemption(r: typeof giftRedemptions.$inferSelect): GiftRedemptionRow {
  return {
    id: r.id,
    studentId: r.studentId,
    month: r.month,
    tierBags: r.tierBags,
    label: r.label,
    staffId: r.staffId,
    note: r.note,
    createdAt: r.createdAt,
  };
}

/** Thrown (and caught by the route) when the same tier was already handed out this month. */
export const ALREADY_REDEEMED = 'already_redeemed';

export async function redeemGift(
  db: Db,
  input: GiftRedeemInput,
  staffId: string,
  nowUtcIso: string,
): Promise<GiftRedemptionRow> {
  const existing = await db
    .select()
    .from(giftRedemptions)
    .where(
      and(
        eq(giftRedemptions.studentId, input.studentId),
        eq(giftRedemptions.month, input.month),
        eq(giftRedemptions.tierBags, input.tierBags),
      ),
    );
  if (existing.length) throw new Error(ALREADY_REDEEMED);

  const cfg = await getCheckinSettings(db);
  // Snapshot the label so a later tier edit doesn't rewrite what the child received.
  const tier = cfg.tiers.find((t) => t.bags === input.tierBags) ?? null;
  const id = crypto.randomUUID();
  await db.insert(giftRedemptions).values({
    id,
    studentId: input.studentId,
    month: input.month,
    tierBags: input.tierBags,
    label: tier?.label ?? null,
    staffId,
    note: input.note ?? null,
    createdAt: nowUtcIso,
  });
  const rows = await db.select().from(giftRedemptions).where(eq(giftRedemptions.id, id));
  const row = mapRedemption(rows[0]);
  recordCreate('gift_redemption', id, row);
  return row;
}

export async function listRedemptions(db: Db, month: string): Promise<GiftRedemptionRow[]> {
  const rows = await db.select().from(giftRedemptions).where(eq(giftRedemptions.month, month));
  return rows.map(mapRedemption);
}
