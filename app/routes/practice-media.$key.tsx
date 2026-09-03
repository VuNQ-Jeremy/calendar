import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { tenantDbFor } from '../../server/db/index';
import { requireLearnerCookieOrBearer } from '../../server/api/auth';
import * as practiceSvc from '../../server/services/practice';

/**
 * Serve one practice proof (photo or video) out of R2.
 *
 * NOT a capability URL like `zalo-media` / `flashcard-images`: a proof is a picture of a child's
 * homework, so it is gated on a session. Both clients need it — the teacher's review queue sends
 * a cookie, the student's app sends a bearer — hence `requireLearnerCookieOrBearer`.
 *
 * Three fences, in order of how cheap they are: the key must have the exact shape
 * `mediaKeyFor` mints, its tenant segment must be the caller's own school, and a student may only
 * fetch a proof attached to one of their own copies.
 */
const KEY_RE =
  /^t\/[A-Za-z0-9_-]+\/practice\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|mov)$/i;

const TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requireLearnerCookieOrBearer(request, env);

  const key = decodeURIComponent(params.key ?? '');
  if (!KEY_RE.test(key)) throw new Response(null, { status: 404 });

  const [, tenantSeg, , studentTaskId] = key.split('/');
  if (tenantSeg !== user.tenantId) throw new Response(null, { status: 404 });

  const db = tenantDbFor(env, user);
  const row = await practiceSvc.getStudentTask(db, studentTaskId);
  // 404 rather than 403 throughout: whether a proof exists is itself not the caller's business.
  if (!row || row.mediaKey !== key) throw new Response(null, { status: 404 });
  if (user.kind === 'student' && row.studentId !== user.user.id) {
    throw new Response(null, { status: 404 });
  }

  const obj = await env.FILES.get(key);
  if (!obj) throw new Response(null, { status: 404 });

  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return new Response(obj.body, {
    headers: {
      'content-type': row.mediaType ?? TYPE_BY_EXT[ext] ?? 'application/octet-stream',
      // `private` because the gate above is per-user — this must never land in a shared cache.
      'cache-control': 'private, max-age=3600',
    },
  });
}

// No default export — a component export would make React Router treat GETs as document
// requests and serve the SSR shell instead of the image. See zalo-media.$key.tsx.
