import { fail, parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/session-preview';
import { SessionPreviewInput } from '../../shared/schemas';
import { flashcardTopics } from '../../server/db/schema';

/**
 * The "preview buổi sau" for ONE occurrence of an event. Recurring events have one row per
 * (eventId, date), so both are required — the same addressing /api/attendance uses.
 *
 * Mirrors the /event-previews resource route that the web modal submits to.
 */
export const loader = withAuth('staff', async ({ request, db }) => {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const date = url.searchParams.get('date');
  if (!eventId || !date) throw fail('missing_event_or_date', 400);
  // Topics ride along with the row so the picker does not need a second request. There are a few
  // dozen of them; the day that stops being true, paginate the picker, not this.
  const [preview, topics] = await Promise.all([
    svc.getRow(db, eventId, date),
    // `pool`, not `own`: the picker offers this school's topics AND the platform library.
    db.raw
      .select({ id: flashcardTopics.id, name: flashcardTopics.name })
      .from(flashcardTopics)
      .where(db.pool(flashcardTopics))
      .orderBy(flashcardTopics.name),
  ]);
  return { preview, topics };
});

export const action = withAuth(
  'staff',
  async ({ request, db }) => svc.save(db, await parseBody(request, SessionPreviewInput)),
  { live: 'previews' },
);
