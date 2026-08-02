import { fail, ok, requireId, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/materials';
import { MaterialInput, parsePatch } from '../../shared/schemas';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB — same cap as the web route.

/**
 * Materials are the one endpoint that stays multipart rather than JSON: the file goes
 * straight to R2, and expo-document-picker yields a URI that React Native's FormData
 * handles natively. Mirrors app/routes/materials.tsx.
 *
 * A JSON body is still accepted for link-only materials (no file).
 */
export const loader = withAuth('staff', ({ db }) => svc.list(db));

function coerce(raw: Record<string, unknown>) {
  const out = { ...raw };
  delete out.file;
  if (typeof out.favorite === 'string') out.favorite = out.favorite === 'true';
  if (out.classId === '') out.classId = null;
  return out;
}

/** Returns the parsed fields plus the upload, from either a multipart or JSON body. */
async function readBody(request: Request): Promise<{ raw: Record<string, unknown>; file?: File }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    try {
      return { raw: coerce((await request.json()) as Record<string, unknown>) };
    } catch {
      throw fail('invalid_json', 400);
    }
  }
  const form = await request.formData();
  const fileRaw = form.get('file');
  const file = fileRaw instanceof File && fileRaw.size > 0 ? fileRaw : undefined;
  if (file && file.size > MAX_FILE_SIZE) throw fail('file_too_large', 413);
  return { raw: coerce(Object.fromEntries(form) as Record<string, unknown>), file };
}

export const action = withAuth(
  'staff',
  async (ctx) => {
    const { request, db, env } = ctx;

    if (request.method === 'DELETE') {
      await svc.remove(db, requireId(ctx), env.FILES);
      return { id: requireId(ctx) };
    }

    const { raw, file } = await readBody(request);

    if (request.method === 'POST') {
      const parsed = MaterialInput.safeParse(raw);
      if (!parsed.success) throw fail('validation_failed', 422, parsed.error.issues);
      return svc.create(db, parsed.data, file, env.FILES);
    }

    if (request.method === 'PATCH') {
      const parsed = parsePatch(MaterialInput, raw);
      if (!parsed.success) throw fail('validation_failed', 422, parsed.error.issues);
      return svc.update(db, requireId(ctx), parsed.data, file, env.FILES);
    }

    return ok({ error: 'method_not_allowed' }, 405);
  },
  { live: 'materials' },
);
