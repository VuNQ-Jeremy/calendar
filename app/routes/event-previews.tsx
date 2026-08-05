import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as previewSvc from '../../server/services/session-preview';
import { SessionPreviewInput } from '../../shared/schemas';
import { flashcardTopics } from '../../server/db/schema';
import { withLiveAction } from '../../server/live';

/**
 * Resource route for the "Buổi sau" tab of the calendar event modal — the cookie-authenticated
 * twin of /api/event-previews, which serves the mobile app over a bearer token.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const date = url.searchParams.get('date');
  if (!eventId || !date) return Response.json({ error: 'missing params' }, { status: 400 });
  const [preview, topics] = await Promise.all([
    previewSvc.getRow(db, eventId, date),
    db
      .select({ id: flashcardTopics.id, name: flashcardTopics.name })
      .from(flashcardTopics)
      .orderBy(flashcardTopics.name),
  ]);
  return { preview, topics };
}

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  if (formData.get('intent') !== 'save') {
    return Response.json({ error: 'unknown intent' }, { status: 400 });
  }

  const parsed = SessionPreviewInput.safeParse({
    eventId: formData.get('eventId'),
    date: formData.get('date'),
    focusText: formData.get('focusText') ?? '',
    // An empty select means "no topic", which the column stores as NULL.
    vocabTopicId: (formData.get('vocabTopicId') as string) || null,
  });
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  const preview = await previewSvc.save(db, parsed.data);
  return { ok: true, preview };
}

export const action = withLiveAction('previews', actionImpl);
