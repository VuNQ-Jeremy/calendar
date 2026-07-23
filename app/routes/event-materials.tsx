import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as eventMaterialsSvc from '../../server/services/event-materials';
import { EventMaterialsSaveInput } from '../../shared/schemas';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  if (!eventId) return Response.json({ error: 'missing params' }, { status: 400 });
  const materialIds = await eventMaterialsSvc.listForEvent(db, eventId);
  return { materialIds };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  if (intent !== 'save') return Response.json({ error: 'unknown intent' }, { status: 400 });

  let idsRaw: unknown;
  try {
    idsRaw = JSON.parse((formData.get('materialIds') as string) ?? '[]');
  } catch {
    return Response.json({ error: 'bad materialIds json' }, { status: 400 });
  }

  const parsed = EventMaterialsSaveInput.safeParse({
    eventId: formData.get('eventId'),
    materialIds: idsRaw,
  });
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  const materialIds = await eventMaterialsSvc.setForEvent(
    db,
    parsed.data.eventId,
    parsed.data.materialIds,
  );
  return { ok: true, materialIds };
}
