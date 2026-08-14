import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { CalendarScreen } from '../../src/calendar/index.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import * as eventsSvc from '../../server/services/events';
import { requireStaff } from '../../server/services/auth';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as themeSvc from '../../server/services/theme';
import * as materialsSvc from '../../server/services/materials';
import * as eventMaterialsSvc from '../../server/services/event-materials';
import type { Theme } from '../../server/services/theme';
import { EventInput, EventEditScope, ThemeInput, parsePatch } from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const [events, classes, students, theme, materials, eventMaterials] = await Promise.all([
    eventsSvc.list(db),
    classesSvc.list(db),
    peopleSvc.listStudents(db),
    themeSvc.getTheme(db),
    materialsSvc.list(db),
    eventMaterialsSvc.listAll(db),
  ]);
  return { events, classes, students, theme, materials, eventMaterials };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.calendar, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
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

  // `scope` and `occurrenceDate` name an operation and an occurrence rather than columns, so they
  // never reach EventInput — both intents read them straight off the form. Absent scope means
  // 'all', which is the pre-scope behavior every other client (mobile) still relies on.
  const day = (v: FormDataEntryValue | null) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  const occurrenceDate = day(formData.get('occurrenceDate'));
  const scope = EventEditScope.catch('all').parse(formData.get('scope') ?? 'all');
  if (scope !== 'all' && !occurrenceDate)
    return Response.json({ error: 'missing occurrenceDate' }, { status: 400 });

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    if (scope === 'single') await eventsSvc.removeSingle(db, id, occurrenceDate!);
    else if (scope === 'following') await eventsSvc.removeFollowing(db, id, occurrenceDate!);
    else await eventsSvc.remove(db, id);
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
    if (scope === 'following')
      await eventsSvc.updateFollowing(db, id, occurrenceDate!, parsed.data);
    else if (scope === 'single') await eventsSvc.updateSingle(db, id, occurrenceDate!, parsed.data);
    // `fromDate` is the pre-scope spelling of the same idea and still arrives from mobile; either
    // field turns an edited occurrence's date into a delta. See eventsSvc.update's `fromDate`.
    else
      await eventsSvc.update(db, id, parsed.data, day(formData.get('fromDate')) ?? occurrenceDate);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('calendar', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('calendar');
  }
}

export default function Calendar() {
  return <CalendarScreen />;
}
