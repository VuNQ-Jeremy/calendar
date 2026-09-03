import { fail, withAuth } from '../../server/api/handler';
import * as practiceSvc from '../../server/services/practice';
import { MEDIA_MAX_BYTES } from '../../shared/logic/practice';
import { PracticeSubmitInput } from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';

/**
 * POST /api/practice/submit — the student's proof, as multipart.
 *
 * Multipart rather than a JSON body with a base64 blob: a 50 MB video would otherwise be a 67 MB
 * string held whole in the isolate. The file streams straight into R2 and only its key is stored.
 *
 * Media is written BEFORE the row is updated, so a failed update leaves an orphan object (swept
 * by nothing, but harmless and tiny) rather than a row pointing at an object that never landed.
 */
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** Service errors are strings by contract; this is the one place they become HTTP. */
const STATUS_FOR: Record<string, number> = {
  not_found: 404,
  deadline_passed: 409,
  already_done: 409,
  proof_required: 422,
  wrong_proof: 422,
};

export const action = withAuth(
  'user',
  async ({ db, env, request, user }) => {
    if (user.kind !== 'student') throw fail('forbidden', 403);
    if (request.method !== 'POST') throw fail('method_not_allowed', 405);

    const form = await request.formData();
    const parsed = PracticeSubmitInput.safeParse({
      studentTaskId: form.get('studentTaskId'),
      timeFrom: form.get('timeFrom') || null,
      timeTo: form.get('timeTo') || null,
      note: form.get('note') || null,
    });
    if (!parsed.success) throw fail('validation_failed', 422, parsed.error.issues);
    const input = parsed.data;

    let media: { key: string; type: string } | null = null;
    const file = form.get('file');
    if (file instanceof File && file.size > 0) {
      if (file.size > MEDIA_MAX_BYTES) throw fail('file_too_large', 413);
      const ext = ALLOWED[file.type];
      if (!ext) throw fail('bad_media_type', 415);
      const key = practiceSvc.mediaKeyFor(db.tenantId, input.studentTaskId, ext);
      await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
      media = { key, type: file.type };
    }

    const today = ictDateOf(new Date().toISOString());
    let row;
    try {
      row = await practiceSvc.submit(db, user.user.id, input, media, today);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'internal_error';
      throw fail(code, STATUS_FOR[code] ?? 500);
    }

    const titles = await practiceSvc.materialTitles(db, row.materialId ? [row.materialId] : []);
    const cls = (await practiceSvc.enabledClassesFor(db, user.user.id)).find(
      (c) => c.classId === row.classId,
    );
    return practiceSvc.toApiTask(
      row,
      cls?.className ?? '',
      row.materialId ? (titles.get(row.materialId) ?? null) : null,
    );
  },
  // An accepted submission changes the teacher's review queue, so open browser tabs refresh.
  { live: 'practice' },
);
