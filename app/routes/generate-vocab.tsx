import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import { VocabGenerateInput } from '../../shared/schemas';
import type { GeneratedWord } from '../../shared/schemas';

// Resource route (no default component). Like /translate, registered OUTSIDE the `_app` layout
// so posting here does NOT invalidate the flashcards route cache — generation only proposes
// words; the save happens afterwards via the topic route's `words-import` intent, which does
// its own invalidation.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaffCookieOrBearer(request, env); // only staff add/import words
  if (!env.ANTHROPIC_API_KEY) return Response.json({ error: 'disabled' }, { status: 503 });

  // The web screen posts FormData with a `payload` JSON string; the mobile client posts a plain
  // JSON body. Accept either, so both clients share this one route.
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
  const parsed = VocabGenerateInput.safeParse(payload);
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  // Route the Anthropic call through the Durable Object pinned to the US (`locationHint:
  // 'enam'`) — Anthropic geo-blocks the Hong Kong egress Cloudflare would otherwise use for
  // Vietnam traffic. Same DO as /translate; the `/generate` path selects the operation.
  const stub = env.TRANSLATE_DO.get(env.TRANSLATE_DO.idFromName('anthropic-us'), {
    locationHint: 'enam',
  });
  const res = await stub.fetch('https://translate-do.internal/generate', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  });
  // Failures pass straight through: the DO already speaks the `{ error }` envelope the mobile
  // apiFetch expects. Success is re-wrapped as `{ data }` because — unlike /translate — the
  // mobile client calls this route, and apiFetch unwraps every 2xx body's `data` field.
  if (!res.ok) return res;
  const json = (await res.json()) as { words: GeneratedWord[] };
  return Response.json({ data: json });
}
