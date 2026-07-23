import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as translateSvc from '../../server/services/translate';
import { TranslateInput } from '../../shared/schemas';

// Resource route (no default component). Deliberately registered OUTSIDE the
// `_app` layout so posting here does NOT invalidate the flashcards route cache
// (the topic route's clientAction runs `invalidate('route:flashcards')` on
// every action). Translation is a read-side enrichment, not a data mutation.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env); // only staff add/import words
  if (!env.ANTHROPIC_API_KEY) return Response.json({ error: 'disabled' }, { status: 503 });

  const formData = await request.formData();
  let items: unknown;
  try {
    items = JSON.parse((formData.get('items') as string) ?? '[]');
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = TranslateInput.safeParse({ items });
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  try {
    const translations = await translateSvc.translateWords(env.ANTHROPIC_API_KEY, parsed.data.items);
    return Response.json({ translations });
  } catch {
    return Response.json({ error: 'translate_failed' }, { status: 502 });
  }
}
