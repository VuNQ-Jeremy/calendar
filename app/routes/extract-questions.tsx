import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import { QuestionExtractInput } from '../../shared/schemas';
import type { ImportedQuestionDraft } from '../../shared/logic/question-import';

// Resource route (no default component). Like /generate-vocab, registered OUTSIDE the `_app`
// layout so posting here does NOT invalidate the questions/tests route caches — extraction only
// PROPOSES questions. The save happens afterwards via the `import` / `import-questions` intents on
// /questions and /tests/:id, which do their own invalidation.
//
// Staff-only and web-only: the mobile app has no tests UI, so there is no bearer-token path here.
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  if (!env.ANTHROPIC_API_KEY) return Response.json({ error: 'disabled' }, { status: 503 });

  // A PDF arrives as base64 inside a JSON body (megabytes of it), so this route reads JSON
  // directly rather than going through FormData like the intent-based page actions.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = QuestionExtractInput.safeParse(payload);
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  // Route the Anthropic call through the Durable Object pinned to the US (`locationHint: 'enam'`)
  // — Anthropic geo-blocks the Hong Kong egress Cloudflare would otherwise use for Vietnam
  // traffic. Same DO as /translate and /generate; the path selects the operation.
  const stub = env.TRANSLATE_DO.get(env.TRANSLATE_DO.idFromName('anthropic-us'), {
    locationHint: 'enam',
  });
  const res = await stub.fetch('https://translate-do.internal/extract-questions', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  });
  // Failures pass straight through — the DO already speaks the `{ error }` envelope the review
  // modal reads (`extract_truncated` gets its own message).
  if (!res.ok) return res;
  const json = (await res.json()) as { questions: ImportedQuestionDraft[] };
  return Response.json(json);
}
