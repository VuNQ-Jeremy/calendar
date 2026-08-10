import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import { VocabImageGenerateInput } from '../../shared/schemas';
import { generateImage } from '../../server/services/vocab-images';

/**
 * Draw an illustration for a word with Workers AI, store it, and return its key. Staff only, and
 * outside `_app` for the same reason as /vocab-image-search.
 *
 * Unlike a stock pick, the bytes exist nowhere else, so they are written to R2 here rather than at
 * save time. The object is therefore unreferenced until the word is saved — which is exactly the
 * case `pruneImages` cleans up if the teacher walks away, so nothing needs undoing on this path.
 *
 * Slow by nature (a few seconds), so the caller shows a spinner.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaffCookieOrBearer(request, env);

  let payload: unknown;
  try {
    if ((request.headers.get('content-type') ?? '').includes('application/json')) {
      payload = await request.json();
    } else {
      const formData = await request.formData();
      payload = JSON.parse((formData.get('payload') as string) ?? '{}');
    }
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = VocabImageGenerateInput.safeParse(payload);
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  try {
    const imageKey = await generateImage(env, parsed.data.prompt);
    return Response.json({ data: { imageKey } });
  } catch {
    return Response.json({ error: 'generate_failed' }, { status: 502 });
  }
}
