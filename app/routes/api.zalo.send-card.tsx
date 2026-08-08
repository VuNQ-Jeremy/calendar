import { fail, withAuth } from '../../server/api/handler';
import * as zalo from '../../server/services/zalo';

/**
 * Post a share card to Zalo. **Staff only.**
 *
 *   POST /api/zalo/send-card   multipart: file=<png>, target=class:<id>|student:<id>, caption?
 *
 * This replaces the manual flow the school runs today — render the card, copy the image, open
 * the class group, paste — with one button. The copy button stays next to it: when Zalo is down
 * or a group is not linked, the manual route is the fallback, and it is the one everyone knows.
 *
 * **Why the image is uploaded rather than rendered here.** Every share card is drawn in the
 * browser by html-to-image from live DOM. A Worker has no DOM, so the PNG can only come from the
 * page that made it. That is also why the cron jobs post text to groups and never images.
 *
 * The upload lands in R2 under `zalo/` and is served by the capability-URL route
 * `/zalo-media/:key`, because Zalo fetches the photo itself and cannot authenticate.
 */

/** Comfortably above a share card at 2× pixel ratio; far below the 20 MB materials cap. */
const MAX_BYTES = 5 * 1024 * 1024;

export const action = withAuth('staff', async ({ request, db, env }) => {
  if (request.method !== 'POST') throw fail('method_not_allowed', 405);
  if (!zalo.isEnabled(env)) throw fail('zalo_disabled', 503);

  const form = await request.formData();
  const file = form.get('file');
  const target = String(form.get('target') ?? '');
  const caption = String(form.get('caption') ?? '').slice(0, 2000);

  if (!(file instanceof File)) throw fail('missing_file', 400);
  if (file.size > MAX_BYTES) throw fail('file_too_large', 413);

  const [kind, id] = target.split(':');
  if (!id || (kind !== 'class' && kind !== 'student')) throw fail('bad_target', 400);

  // A class posts to its group; a student's slip goes privately to that student's parents. Both
  // resolve to a list so the caller gets the same shape either way.
  const chatIds =
    kind === 'class'
      ? [await zalo.chatForClass(db, id)].filter((c): c is string => Boolean(c))
      : await zalo.chatsForParentsOfStudents(db, [id]);
  if (!chatIds.length) throw fail('not_linked', 409);

  // Uploaded before sending, and only after a recipient is known: an object nobody will ever be
  // told about is just litter for the weekly prune to collect.
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
  return { sent: results.filter((r) => r.ok).length, total: results.length, results };
});
