import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import { VocabImageCommitInput } from '../../shared/schemas';
import { commitImage } from '../../server/services/vocab-images';
import { record } from '../../server/services/audit';

/**
 * Copy a chosen stock picture into our bucket and return its key. Staff only, outside `_app`.
 *
 * Takes a provider plus that provider's id — never a URL. The service asks the provider where the
 * image lives, so the address actually fetched is chosen by the provider rather than by the
 * caller, and this route cannot be turned into a general-purpose fetcher.
 *
 * Called at save time for a stock pick (so cancelling a review leaves nothing behind), and
 * immediately when editing a single word.
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
  const parsed = VocabImageCommitInput.safeParse(payload);
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  try {
    const imageKey = await commitImage(env, parsed.data.provider, parsed.data.id);
    // R2-only write — same bespoke-route reasoning as /vocab-image-generate.
    record({
      action: 'mutation',
      meta: { kind: 'vocab_image_commit', provider: parsed.data.provider, imageKey },
    });
    return Response.json({ data: { imageKey } });
  } catch {
    return Response.json({ error: 'commit_failed' }, { status: 502 });
  }
}
