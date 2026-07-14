import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { HomeworkScreen } from '../../src/screens-core.jsx';
import { createDb } from '../../server/db/index';
import * as homeworkSvc from '../../server/services/homework';
import * as classesSvc from '../../server/services/classes';
import { HomeworkInput } from '../../shared/schemas';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const [homework, classes] = await Promise.all([homeworkSvc.list(db), classesSvc.listLite(db)]);
  return { homework, classes };
}

function preprocessHwRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (out.points === '') delete out.points;
  if (typeof out.done === 'string') out.done = out.done === 'true';
  return out;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await homeworkSvc.remove(db, id);
    return { ok: true };
  }

  const raw = preprocessHwRaw(Object.fromEntries(formData) as Record<string, unknown>);

  if (intent === 'create') {
    const parsed = HomeworkInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await homeworkSvc.create(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = HomeworkInput.partial().safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await homeworkSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Homework() {
  return <HomeworkScreen />;
}
