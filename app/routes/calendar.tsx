import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { CalendarScreen } from '../../src/calendar/index.jsx';
import { createDb } from '../../server/db/index';
import * as eventsSvc from '../../server/services/events';
import * as classesSvc from '../../server/services/classes';
import * as themeSvc from '../../server/services/theme';
import { EventInput, ThemeInput } from '../../shared/schemas';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const [events, classes, theme] = await Promise.all([
    eventsSvc.list(db),
    classesSvc.listLite(db),
    themeSvc.getTheme(db),
  ]);
  return { events, classes, theme };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'theme') {
    const raw = Object.fromEntries(formData);
    const parsed = ThemeInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const theme = await themeSvc.setTheme(db, parsed.data);
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
    const parsed = EventInput.partial().safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await eventsSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Calendar() {
  return <CalendarScreen />;
}
