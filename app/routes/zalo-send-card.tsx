import type { ActionFunctionArgs } from 'react-router';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import * as zalo from '../../server/services/zalo';
import * as assessSvc from '../../server/services/assessments';
import { notifyLive } from '../../server/live';
import { record } from '../../server/services/audit';

/**
 * Post a share card into Zalo. **Staff only.**
 *
 *   POST /zalo-send-card   multipart: file=<png>, caption?, and one target:
 *
 *     class:<classId>        the class group chat
 *     student:<studentId>    that student's family, by either route — parent record or a chat
 *                            paired straight to the student
 *     parent-of:<studentId>  ONLY a `parents` record for that student
 *
 * Optional `remarkId`: the monthly report slip passes the monthly_remarks row it was rendered
 * from, and a delivery that reached at least one chat stamps that row's `sent_at`.
 *
 * The last one is for money. A student link is whoever redeemed that student's code, which may
 * be the student; a class reminder reaching a teenager is fine, a fee slip is not. So the slip
 * asks for `parent-of:` and gets `not_linked` when no parent record is paired, rather than
 * quietly sending the bill to the child. The id after `parent-of:` is a STUDENT id — the parents
 * are resolved from it.
 *
 * This replaces the flow the school runs by hand today — render the card, copy the image, open
 * the group, paste — with one button. The copy button stays beside it: when a group is not
 * linked or Zalo is down, the manual route still works and is the one everyone knows.
 *
 * **Deliberately NOT under /api/.** Everything there authenticates by `Authorization: Bearer`
 * only (server/api/auth.ts), and every caller of this endpoint is a browser holding a session
 * cookie and no header — the share cards are document routes outside the app layout. Living at
 * /api/ earned a 401 on every click, which the client could only report as a generic failure.
 * `requireStaffCookieOrBearer` accepts both, so one route serves the web today and a bearer
 * client later. Same reasoning, and the same trap, as app/routes/garden-month.tsx.
 *
 * **Why the image is uploaded rather than rendered here.** Every share card is drawn in the
 * browser by html-to-image from live DOM, and a Worker has no DOM — so the PNG can only come
 * from the page that made it. That is also why the cron jobs post text to groups, never images.
 *
 * The upload lands in R2 under `zalo/` and is served by the capability-URL route
 * `/zalo-media/:key`, because Zalo fetches the photo itself and cannot authenticate.
 */

/** Comfortably above a share card at 2× pixel ratio; far below the 20 MB materials cap. */
const MAX_BYTES = 5 * 1024 * 1024;

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { env, ctx } = context.get(cloudflareCtx);
  await requireStaffCookieOrBearer(request, env);
  if (request.method !== 'POST') return fail('method_not_allowed', 405);
  if (!zalo.isEnabled(env)) return fail('zalo_disabled', 503);

  const db = createDb(env);
  const form = await request.formData();
  const file = form.get('file');
  const target = String(form.get('target') ?? '');
  const caption = String(form.get('caption') ?? '').slice(0, 2000);

  if (!(file instanceof File)) return fail('missing_file', 400);
  if (file.size > MAX_BYTES) return fail('file_too_large', 413);

  const [kind, id] = target.split(':');
  if (!id || (kind !== 'class' && kind !== 'student' && kind !== 'parent-of')) {
    return fail('bad_target', 400);
  }

  // Every branch resolves to a list, so the caller gets the same shape whichever it asked for.
  const chatIds =
    kind === 'class'
      ? [await zalo.chatForClass(db, id)].filter((c): c is string => Boolean(c))
      : kind === 'parent-of'
        ? await zalo.chatsForParentRecordsOf(db, [id])
        : await zalo.chatsForParentsOfStudents(db, [id]);
  if (!chatIds.length) return fail('not_linked', 409);

  // Uploaded only once a recipient is known: an object nobody will ever be told about is just
  // litter for the weekly prune to collect.
  const key = `${crypto.randomUUID()}.png`;
  await env.FILES.put(`zalo/${key}`, file.stream(), {
    httpMetadata: { contentType: 'image/png' },
  });
  const url = new URL(`/zalo-media/${key}`, new URL(request.url).origin).toString();

  // Per-chat results rather than one boolean: with several parents, "it worked" and "it worked
  // for three of four" are different things, and the UI should be able to say which.
  const results = [];
  for (const chatId of chatIds) {
    results.push({ chatId, ok: await zalo.sendPhoto(env, chatId, url, caption) });
  }
  const sent = results.filter((r) => r.ok).length;

  // Optional send-tracking: the monthly report slip passes the remark row it was rendered from,
  // and a delivery that reached at least one chat stamps monthly_remarks.sent_at. try/catch so a
  // bookkeeping hiccup can never turn a delivered photo into a reported failure — the send
  // happened either way. notifyLive because the roster on /assessments shows the stamp as a
  // "Sent" badge and this document tab has no route cache of its own to invalidate: the
  // broadcast is the only freshness channel there is, and a downed hub honestly degrades to
  // stale-until-next-load.
  const remarkId = String(form.get('remarkId') ?? '');
  if (remarkId && sent > 0) {
    try {
      await assessSvc.markRemarkSent(db, remarkId);
      notifyLive(env, ctx, 'assessments');
    } catch (err) {
      console.error('[zalo] sent-stamp failed', { remarkId, err: String(err) });
    }
  }

  // Outside withLiveAction/withAuth (this route is a bespoke document-cookie-authed resource
  // route, not one of those wrappers), so it records its own coarse row rather than getting one
  // for free.
  record({
    action: 'mutation',
    meta: {
      kind: 'zalo_send_card',
      target,
      sent,
      total: results.length,
      remarkId: remarkId || null,
    },
  });
  return Response.json({ sent, total: results.length, results }, { status: sent ? 200 : 502 });
}

// No default export: a resource route. A component export would make React Router treat this as
// a document request and serve the SSR shell instead of JSON.
