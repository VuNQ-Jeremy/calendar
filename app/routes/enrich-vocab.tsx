import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import { VocabEnrichInput } from '../../shared/schemas';
import type { EnrichedWord } from '../../shared/schemas';

// Resource route (no default component). Deliberately registered OUTSIDE the `_app` layout so
// posting here does NOT invalidate the flashcards route cache (the topic route's clientAction runs
// `invalidate('route:flashcards')` on every action). Enrichment only proposes field values; the
// save happens afterwards through the topic route's own intents, which do their own invalidation.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaffCookieOrBearer(request, env); // only staff add/import words
  if (!env.ANTHROPIC_API_KEY) return Response.json({ error: 'disabled' }, { status: 503 });

  // The web screens post FormData with an `items` JSON string; the mobile client posts a plain
  // JSON body. Accept either, so both clients share this one route.
  let items: unknown;
  let quality: unknown;
  try {
    if ((request.headers.get('content-type') ?? '').includes('application/json')) {
      const body = (await request.json()) as { items?: unknown; quality?: unknown };
      items = body.items ?? [];
      quality = body.quality;
    } else {
      const formData = await request.formData();
      items = JSON.parse((formData.get('items') as string) ?? '[]');
      quality = formData.get('quality') ?? undefined;
    }
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  // `quality` defaults to 'fast' in the schema, so an existing client that never sends it keeps the
  // cheap interactive tier — the expensive one is only ever reached by asking for it.
  const parsed = VocabEnrichInput.safeParse({ items, ...(quality ? { quality } : {}) });
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  // Route the Anthropic call through the Durable Object pinned to the US (`locationHint:
  // 'enam'`) — Anthropic geo-blocks the Hong Kong egress Cloudflare would otherwise use for
  // Vietnam traffic. Same DO as /generate-vocab; the `/enrich` path selects the operation.
  const stub = env.TRANSLATE_DO.get(env.TRANSLATE_DO.idFromName('anthropic-us'), {
    locationHint: 'enam',
  });
  const res = await stub.fetch('https://translate-do.internal/enrich', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  });
  // Failures pass straight through: the DO already speaks the `{ error }` envelope the mobile
  // apiFetch expects. Success is re-wrapped as `{ data }` because the mobile client calls this
  // route too, and apiFetch unwraps every 2xx body's `data` field.
  if (!res.ok) return res;
  const json = (await res.json()) as { words: EnrichedWord[] };
  return Response.json({ data: json });
}
