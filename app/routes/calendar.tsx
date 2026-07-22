import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { CalendarScreen } from '../../src/calendar/index.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import * as eventsSvc from '../../server/services/events';
import { requireUser } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as themeSvc from '../../server/services/theme';
import type { Theme } from '../../server/services/theme';
import { EventInput, ThemeInput, parsePatch } from '../../shared/schemas';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const [events, classes, students, theme] = await Promise.all([
    eventsSvc.list(db),
    classesSvc.list(db),
    peopleSvc.listStudents(db),
    themeSvc.getTheme(db),
  ]);
  return { events, classes, students, theme };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'theme') {
    const raw = Object.fromEntries(formData);
    const parsed = ThemeInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v != null),
    ) as Partial<Theme>;
    const theme = await themeSvc.setTheme(db, patch);
    return { ok: true, theme };
  }

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await eventsSvc.remove(db, id);
    return { ok: true };
  }

  const raw = Object.fromEntries(formData);

  if (intent === 'create') {
    const parsed = EventInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await eventsSvc.create(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(EventInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await eventsSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Calendar() {
  return <CalendarScreen />;
}
