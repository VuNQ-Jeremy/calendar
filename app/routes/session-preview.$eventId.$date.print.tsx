import type { LoaderFunctionArgs } from 'react-router';
import { PreviewSlipView } from '../../src/preview/preview-slip.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as eventsSvc from '../../server/services/events';
import * as classesSvc from '../../server/services/classes';
import * as previewSvc from '../../server/services/session-preview';

/**
 * The "Nhắc buổi sau" share card for one occurrence.
 *
 * Registered OUTSIDE the `_app` layout — a document, not an app screen: no shell, no nav chrome,
 * and no route cache (`cacheKeyForPath` matches single trailing segments only, so this multi-segment
 * path falls through to null).
 *
 * `requireStaff`, not `requireAdmin` as the fee slip uses: any teacher makes these, and unlike a
 * phiếu thu there is no money on the card.
 */
export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);

  const date = params.date ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw Response.json({ error: 'bad_date' }, { status: 400 });

  const all = await eventsSvc.list(db);
  const ev = all.find((e) => e.id === params.eventId);
  if (!ev) throw Response.json({ error: 'unknown_event' }, { status: 404 });
  if (!ev.classId) throw Response.json({ error: 'event_has_no_class' }, { status: 400 });

  // The date is not checked against the recurrence. The teacher arrives here from an occurrence
  // they clicked, and composeMany is honest about whatever date it is given — a hand-typed URL for
  // a day the class does not run produces a truthful if pointless card, not a wrong one.
  const [cls, previews] = await Promise.all([
    classesSvc.get(db, ev.classId),
    previewSvc.composeMany(db, [{ id: ev.id, classId: ev.classId, date }]),
  ]);

  return {
    date,
    // The id as well as the name: the card's "send to Zalo" button posts into this class's group
    // chat, and a name cannot address one.
    classId: ev.classId,
    className: cls?.name ?? ev.title,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    location: ev.location,
    preview: previews.get(previewSvc.previewKey(ev.id, date)) ?? {
      focusText: '',
      vocabTopic: null,
      tests: [],
    },
  };
}

export default function SessionPreviewPrint() {
  return <PreviewSlipView />;
}
