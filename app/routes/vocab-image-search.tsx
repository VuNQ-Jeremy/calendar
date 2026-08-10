import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import { VocabImageSearchInput } from '../../shared/schemas';
import { searchImages } from '../../server/services/vocab-images';

/**
 * Propose pictures for one word. Staff only, and — like /generate-vocab — registered OUTSIDE the
 * `_app` layout so browsing the picker never invalidates the vocabulary route cache: searching
 * only suggests, and nothing is written until the teacher saves the word.
 *
 * Always available: with no PIXABAY_API_KEY the service falls back to Openverse, which needs no
 * credentials. An empty `candidates` array means "nothing matched", not "search is broken" — the
 * picker shows an empty state for it, and reserves the error path for a 502.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaffCookieOrBearer(request, env); // only staff edit words

  // The web screen posts FormData with a `payload` JSON string; a mobile client would post a
  // plain JSON body. Accept either, so both can share this one route.
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
  const parsed = VocabImageSearchInput.safeParse(payload);
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  try {
    const { candidates, provider } = await searchImages(env, parsed.data.query);
    return Response.json({ data: { candidates, provider } });
  } catch {
    return Response.json({ error: 'search_failed' }, { status: 502 });
  }
}
