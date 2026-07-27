import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import { TranslateInput } from '../../shared/schemas';

// Resource route (no default component). Deliberately registered OUTSIDE the
// `_app` layout so posting here does NOT invalidate the flashcards route cache
// (the topic route's clientAction runs `invalidate('route:flashcards')` on
// every action). Translation is a read-side enrichment, not a data mutation.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaffCookieOrBearer(request, env); // only staff add/import words
  if (!env.ANTHROPIC_API_KEY) return Response.json({ error: 'disabled' }, { status: 503 });

  // The web screen posts FormData with an `items` JSON string; the mobile client posts a
  // plain JSON body. Accept either, so both clients share this one route.
  let items: unknown;
  try {
    if ((request.headers.get('content-type') ?? '').includes('application/json')) {
      items = ((await request.json()) as { items?: unknown }).items ?? [];
    } else {
      const formData = await request.formData();
      items = JSON.parse((formData.get('items') as string) ?? '[]');
    }
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = TranslateInput.safeParse({ items });
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  // Route the Anthropic call through a Durable Object pinned to the US
  // (`locationHint: 'enam'`). Cloudflare serves this Worker from Hong Kong for
  // Vietnam traffic, and Anthropic geo-blocks HKG egress (403). The DO runs in
  // the US, so its outbound request reaches Anthropic from a supported region.
  const stub = env.TRANSLATE_DO.get(env.TRANSLATE_DO.idFromName('anthropic-us'), {
    locationHint: 'enam',
  });
  return stub.fetch('https://translate-do.internal/', {
    method: 'POST',
    body: JSON.stringify(parsed.data.items),
  });
}
