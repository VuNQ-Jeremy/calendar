import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { useOutletContext } from 'react-router';
import { FeedbackScreen } from '../../src/feedback.jsx';
import type { AppContext } from './_app.js';
import { createDb } from '../../server/db/index';
import * as feedbackSvc from '../../server/services/feedback';
import { FeedbackInput } from '../../shared/schemas';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const feedback = await feedbackSvc.list(db);
  return { feedback };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await feedbackSvc.remove(db, id);
    return { ok: true };
  }

  const raw = Object.fromEntries(formData);

  if (intent === 'create') {
    const parsed = FeedbackInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await feedbackSvc.create(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = FeedbackInput.partial().safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await feedbackSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Feedback() {
  const { user } = useOutletContext<AppContext>();
  return <FeedbackScreen user={user} />;
}
