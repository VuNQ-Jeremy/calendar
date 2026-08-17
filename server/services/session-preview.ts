import { eq, inArray } from 'drizzle-orm';
import {
  classStudents,
  flashcardTopics,
  flashcardWords,
  sessionPreviews,
  tests,
} from '../db/schema';
import type { TenantDb } from '../db/index';
import type { SessionPreviewInput } from '../../shared/schemas';
import {
  ICT_OFFSET_MIN,
  testTouchesOccurrence,
  type ComposedPreview,
  type PreviewVocabTopic,
} from '../../shared/logic/preview';
import { expandEvents } from '../../shared/logic/recurrence';
import { iso, parseISO, toMin } from '../../shared/logic/dates';
import * as classesSvc from './classes';
import * as eventsSvc from './events';

/**
 * "Preview buổi sau" — reads and writes the per-occurrence preview row, and composes it with the
 * data nobody has to type in (the tests falling on that day).
 *
 * Table: migrations/0024_session_previews.sql.
 *
 * One composer, four consumers: the staff editor route, the student's upcoming-sessions endpoint,
 * the evening push job, and the Zalo share image. Composing in one place is what keeps a parent's
 * shared image and the student's push from disagreeing about what is being checked.
 */

export type SessionPreviewRow = {
  eventId: string;
  date: string;
  focusText: string;
  vocabTopicId: string | null;
  updatedAt: string | null;
};

function map(r: typeof sessionPreviews.$inferSelect): SessionPreviewRow {
  return {
    eventId: r.eventId,
    date: r.date,
    focusText: r.focusText,
    vocabTopicId: r.vocabTopicId,
    updatedAt: r.updatedAt,
  };
}

export async function getRow(
  db: TenantDb,
  eventId: string,
  date: string,
): Promise<SessionPreviewRow | null> {
  const rows = await db.raw
    .select()
    .from(sessionPreviews)
    .where(
      db.own(sessionPreviews, eq(sessionPreviews.eventId, eventId), eq(sessionPreviews.date, date)),
    );
  return rows[0] ? map(rows[0]) : null;
}

export async function save(db: TenantDb, input: SessionPreviewInput): Promise<SessionPreviewRow> {
  const values = {
    eventId: input.eventId,
    date: input.date,
    focusText: input.focusText,
    vocabTopicId: input.vocabTopicId || null,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(sessionPreviews)
    .values(values)
    .onConflictDoUpdate({
      target: [sessionPreviews.eventId, sessionPreviews.date],
      set: {
        focusText: values.focusText,
        vocabTopicId: values.vocabTopicId,
        updatedAt: values.updatedAt,
      },
    });
  return { ...values };
}

/** The key ComposedPreview maps use. Exported so callers build it the same way. */
export function previewKey(eventId: string, date: string): string {
  return `${eventId}:${date}`;
}

/**
 * Compose previews for a batch of occurrences.
 *
 * Deliberately bulk: the evening cron composes every class running tomorrow in one pass, and the
 * student screen composes a week at a time. Three queries regardless of how many occurrences come
 * in, with the (eventId, date) pairing narrowed in JS — D1 has no cheap way to express "any of
 * these composite keys", and the row counts here are tiny.
 */
export async function composeMany(
  db: TenantDb,
  occs: { id: string; classId: string; date: string }[],
): Promise<Map<string, ComposedPreview>> {
  const out = new Map<string, ComposedPreview>();
  if (!occs.length) return out;

  const eventIds = [...new Set(occs.map((o) => o.id))];
  const classIds = [...new Set(occs.map((o) => o.classId))];

  const [prevRows, testRows] = await Promise.all([
    db.raw
      .select()
      .from(sessionPreviews)
      .where(db.own(sessionPreviews, inArray(sessionPreviews.eventId, eventIds))),
    db.raw
      .select()
      .from(tests)
      .where(db.own(tests, inArray(tests.classId, classIds), eq(tests.status, 'published'))),
  ]);

  const topicIds = [
    ...new Set(prevRows.map((p) => p.vocabTopicId).filter((x): x is string => !!x)),
  ];
  const [topicRows, wordRows] = topicIds.length
    ? await Promise.all([
        // `pool`: a preview may point at the platform library (tenant_id NULL) as well as at
        // one of this school's own topics.
        db.raw
          .select({
            id: flashcardTopics.id,
            name: flashcardTopics.name,
            slug: flashcardTopics.slug,
          })
          .from(flashcardTopics)
          .where(db.pool(flashcardTopics, inArray(flashcardTopics.id, topicIds))),
        // tenant-unscoped: flashcard_words has no tenant_id — a word is reachable only through
        // its topic, and `topicIds` came from the scoped rows above.
        db.raw
          .select({ topicId: flashcardWords.topicId })
          .from(flashcardWords)
          .where(inArray(flashcardWords.topicId, topicIds)),
      ])
    : [[], []];

  const wordCounts = new Map<string, number>();
  for (const w of wordRows) wordCounts.set(w.topicId, (wordCounts.get(w.topicId) ?? 0) + 1);

  for (const occ of occs) {
    const prev = prevRows.find((p) => p.eventId === occ.id && p.date === occ.date);
    const topicRow = prev?.vocabTopicId
      ? topicRows.find((x) => x.id === prev.vocabTopicId)
      : undefined;
    const vocabTopic: PreviewVocabTopic | null = topicRow
      ? {
          id: topicRow.id,
          name: topicRow.name,
          slug: topicRow.slug,
          wordCount: wordCounts.get(topicRow.id) ?? 0,
        }
      : null;

    out.set(previewKey(occ.id, occ.date), {
      focusText: prev?.focusText ?? '',
      vocabTopic,
      tests: testRows
        .filter((t) => t.classId === occ.classId && testTouchesOccurrence(t, occ.date))
        .map((t) => ({
          id: t.id,
          title: t.title,
          mode: t.mode,
          date: t.date,
          openAt: t.openAt,
          closeAt: t.closeAt,
        })),
    });
  }
  return out;
}

export type UpcomingSession = {
  eventId: string;
  date: string;
  start: string | null;
  end: string | null;
  title: string;
  location: string | null;
  classId: string;
  className: string;
  classColor: string;
  preview: ComposedPreview;
};

/** How many occurrences one response will ever carry. A fortnight of daily classes and change. */
const MAX_UPCOMING = 30;

function addDaysIso(dateIso: string, days: number): string {
  const d = parseISO(dateIso);
  d.setDate(d.getDate() + days);
  return iso(d);
}

/**
 * The next `days` days of sessions, with previews.
 *
 * `who.studentId` present -> only the classes that student is enrolled in; absent -> every class,
 * which is what a staff caller gets (the same shape serves a teacher's "what am I preparing"
 * view).
 *
 * Time-sensitive by nature: today's session drops off the list the moment it ends, computed
 * against the SERVER clock in ICT. Clients must not cache this for long — the same reasoning
 * app/routes/my-tests.tsx uses to skip the route cache entirely.
 */
export async function upcomingSessions(
  db: TenantDb,
  who: { studentId?: string },
  days: number,
  at: Date = new Date(),
): Promise<{ serverNow: string; items: UpcomingSession[] }> {
  const serverNow = at.toISOString();

  let classIds: string[] | null = null;
  if (who.studentId) {
    const rows = await db.raw
      .select({ classId: classStudents.classId })
      .from(classStudents)
      .where(db.own(classStudents, eq(classStudents.studentId, who.studentId)));
    classIds = rows.map((r) => r.classId);
    if (!classIds.length) return { serverNow, items: [] };
  }

  // "Now", as the school experiences it (ICT, UTC+7, no DST) — same shift notify.ts applies.
  const shifted = new Date(at.getTime() + ICT_OFFSET_MIN * 60_000);
  const todayIct = shifted.toISOString().slice(0, 10);
  const nowMin = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();

  const all = await eventsSvc.list(db);
  const occs = expandEvents(all, parseISO(todayIct), parseISO(addDaysIso(todayIct, days)))
    .filter((e) => !!e.classId && (!classIds || classIds.includes(e.classId)))
    // A class that finished an hour ago is not "upcoming". Without an end time, keep it: a
    // session with no clock on it is better shown late than hidden all day.
    .filter((e) => e.date > todayIct || !e.end || toMin(e.end) >= nowMin)
    .sort((a, b) =>
      a.date === b.date
        ? (a.start ?? '99:99').localeCompare(b.start ?? '99:99')
        : a.date.localeCompare(b.date),
    )
    .slice(0, MAX_UPCOMING);
  if (!occs.length) return { serverNow, items: [] };

  const [previews, classes] = await Promise.all([
    composeMany(
      db,
      occs.map((e) => ({ id: e.id, classId: e.classId as string, date: e.date })),
    ),
    classesSvc.listLite(db),
  ]);

  const items: UpcomingSession[] = [];
  for (const e of occs) {
    const cls = classes.find((c) => c.id === e.classId);
    if (!cls) continue; // class deleted out from under the event
    items.push({
      eventId: e.id,
      date: e.date,
      start: e.start,
      end: e.end,
      title: e.title,
      location: e.location,
      classId: cls.id,
      className: cls.name,
      classColor: cls.color,
      preview: previews.get(previewKey(e.id, e.date)) ?? {
        focusText: '',
        vocabTopic: null,
        tests: [],
      },
    });
  }
  return { serverNow, items };
}
