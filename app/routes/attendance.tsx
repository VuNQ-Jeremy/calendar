import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as attendanceSvc from '../../server/services/attendance';
import { AttendanceSaveInput } from '../../shared/schemas';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const date = url.searchParams.get('date');
  if (!eventId || !date) return Response.json({ error: 'missing params' }, { status: 400 });
  const records = await attendanceSvc.listForOccurrence(db, eventId, date);
  return { records };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  if (intent !== 'save') return Response.json({ error: 'unknown intent' }, { status: 400 });

  let recordsRaw: unknown;
  try {
    recordsRaw = JSON.parse((formData.get('records') as string) ?? '[]');
  } catch {
    return Response.json({ error: 'bad records json' }, { status: 400 });
  }

  const parsed = AttendanceSaveInput.safeParse({
    eventId: formData.get('eventId'),
    date: formData.get('date'),
    records: recordsRaw,
  });
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  const records = await attendanceSvc.saveOccurrence(
    db,
    parsed.data.eventId,
    parsed.data.date,
    parsed.data.records,
  );
  return { ok: true, records };
}
