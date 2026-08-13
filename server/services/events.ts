import { eq, and, gte, inArray, lte, or, ne } from 'drizzle-orm';
import { events, eventMaterials, checklistItems } from '../db/schema';
import type { Db } from '../db/index';
import type { EventInput } from '../../shared/schemas';
import { addDaysVn, daysBetweenVn } from '../../shared/logic/garden';
import { record, recordCreate, recordDelete } from './audit';

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type EventRow = {
  id: string;
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  color: string | null;
  classId: string | null;
  location: string | null;
  recurrence: string;
  notes: string | null;
};

function map(r: typeof events.$inferSelect): EventRow {
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    start: r.startTime,
    end: r.endTime,
    color: r.color,
    classId: r.classId,
    location: r.location,
    recurrence: r.recurrence,
    notes: r.notes,
  };
}

export async function list(db: Db): Promise<EventRow[]> {
  const rows = await db.select().from(events);
  return rows.map(map);
}

// Recurring events are always included; non-recurring events are filtered by date range.
export async function listRange(db: Db, fromIso: string, toIso: string): Promise<EventRow[]> {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        lte(events.date, toIso),
        or(ne(events.recurrence, 'none'), and(gte(events.date, fromIso))),
      ),
    );
  return rows.map(map);
}

export async function create(db: Db, input: EventInput): Promise<EventRow> {
  const id = crypto.randomUUID();
  await db.insert(events).values({
    id,
    title: input.title,
    date: input.date,
    startTime: input.start ?? null,
    endTime: input.end ?? null,
    color: input.color ?? null,
    classId: input.classId ?? null,
    location: input.location ?? null,
    recurrence: input.recurrence,
    notes: input.notes || null,
  });
  const rows = await db.select().from(events).where(eq(events.id, id));
  const row = map(rows[0]);
  recordCreate('event', id, row);
  return row;
}

/**
 * Move every checklist_items row of this event by `days`. Those rows key on (event_id, date), the
 * same per-occurrence shape attendance_records uses, so moving the event without this leaves a
 * teacher's authored check-in list stranded on a date nothing renders any more.
 *
 * Collected as ids first, then updated one distinct source date at a time: a +7 shift maps 08-12
 * onto 08-19, which is itself a date being shifted, so a plain `WHERE date = ?` sweep would pick
 * up rows it had already moved.
 *
 * Deliberately not applied to attendance_records / session_previews (the orphan caveat documented
 * in attendance.ts stands — a mark describes a session that already happened) nor to tui_mu_events,
 * an append-only ledger of moments a kid already celebrated.
 */
async function shiftChecklistDates(db: Db, eventId: string, days: number): Promise<number> {
  const rows = await db
    .select({ id: checklistItems.id, date: checklistItems.date })
    .from(checklistItems)
    .where(eq(checklistItems.eventId, eventId));
  if (!rows.length) return 0;
  const byDate = new Map<string, string[]>();
  for (const r of rows) {
    const ids = byDate.get(r.date);
    if (ids) ids.push(r.id);
    else byDate.set(r.date, [r.id]);
  }
  for (const [date, ids] of byDate) {
    await db
      .update(checklistItems)
      .set({ date: addDaysVn(date, days) })
      .where(inArray(checklistItems.id, ids));
  }
  return rows.length;
}

export async function update(
  db: Db,
  id: string,
  patch: Partial<EventInput>,
  /**
   * The occurrence date the editor was opened at. A recurring class is one row expanded in memory,
   * and the event modal seeds its date field from the expanded instance — so `patch.date` is that
   * instance's new date, not a new anchor. Passing the instance's old date lets the row move by the
   * delta instead, which keeps the series' history and stops an untouched date field (where new and
   * old are equal) from re-anchoring the series onto whichever occurrence happened to be open.
   * Omit it — mobile, drag-move — and `patch.date` is read as the anchor itself, as before.
   */
  fromDate?: string,
): Promise<EventRow> {
  const beforeRows = await db.select().from(events).where(eq(events.id, id));
  const before = beforeRows[0] ? map(beforeRows[0]) : undefined;

  const set: Partial<typeof events.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  let shiftDays = 0;
  if (patch.date !== undefined && before) {
    shiftDays = daysBetweenVn(fromDate ?? before.date, patch.date);
    if (shiftDays !== 0) set.date = addDaysVn(before.date, shiftDays);
  }
  if (patch.start !== undefined) set.startTime = patch.start ?? null;
  if (patch.end !== undefined) set.endTime = patch.end ?? null;
  if (patch.color !== undefined) set.color = patch.color ?? null;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.location !== undefined) set.location = patch.location ?? null;
  if (patch.recurrence !== undefined) set.recurrence = patch.recurrence;
  if (patch.notes !== undefined) set.notes = patch.notes || null;
  // A real no-op path: an empty set means nothing on the row actually changed, so skip the DB
  // write AND the audit row for it (the activity log must not log a patch that changed nothing).
  if (Object.keys(set).length) {
    await db.update(events).set(set).where(eq(events.id, id));
  }
  const shifted = shiftDays === 0 ? 0 : await shiftChecklistDates(db, id, shiftDays);
  const rows = await db.select().from(events).where(eq(events.id, id));
  const after = map(rows[0]);
  if (!sameJson(before, after)) {
    record({
      action: 'update',
      entityType: 'event',
      entityId: id,
      before,
      after,
      ...(shifted ? { meta: { checklistItemsShifted: shifted, shiftDays } } : {}),
    });
  }
  return after;
}

export async function remove(db: Db, id: string): Promise<void> {
  // event_materials rows cascade with the event (ON DELETE CASCADE) — folded into `extra` so
  // which materials were attached survives into before_json.
  const linked = await db
    .select({ materialId: eventMaterials.materialId })
    .from(eventMaterials)
    .where(eq(eventMaterials.eventId, id));
  await recordDelete(db, 'event', events, id, { materialIds: linked.map((r) => r.materialId) });
  await db.delete(events).where(eq(events.id, id));
}

export async function listForToday(db: Db, todayIso: string): Promise<EventRow[]> {
  const rows = await db
    .select()
    .from(events)
    .where(or(eq(events.date, todayIso), ne(events.recurrence, 'none')));
  return rows.map(map);
}
