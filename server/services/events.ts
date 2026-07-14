import { eq, and, lte, or, ne } from 'drizzle-orm';
import { events } from '../db/schema';
import type { Db } from '../db/index';
import type { EventInput } from '../../shared/schemas';

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
        or(ne(events.recurrence, 'none'), and(lte(fromIso, events.date))),
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
  });
  const rows = await db.select().from(events).where(eq(events.id, id));
  return map(rows[0]);
}

export async function update(db: Db, id: string, patch: Partial<EventInput>): Promise<EventRow> {
  const set: Partial<typeof events.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.start !== undefined) set.startTime = patch.start ?? null;
  if (patch.end !== undefined) set.endTime = patch.end ?? null;
  if (patch.color !== undefined) set.color = patch.color ?? null;
  if (patch.classId !== undefined) set.classId = patch.classId ?? null;
  if (patch.location !== undefined) set.location = patch.location ?? null;
  if (patch.recurrence !== undefined) set.recurrence = patch.recurrence;
  if (Object.keys(set).length) {
    await db.update(events).set(set).where(eq(events.id, id));
  }
  const rows = await db.select().from(events).where(eq(events.id, id));
  return map(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(events).where(eq(events.id, id));
}

export async function listForToday(db: Db, todayIso: string): Promise<EventRow[]> {
  const rows = await db
    .select()
    .from(events)
    .where(or(eq(events.date, todayIso), ne(events.recurrence, 'none')));
  return rows.map(map);
}
