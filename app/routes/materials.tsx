import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { MaterialsScreen } from '../../src/screens-extra.jsx';
import { createDb } from '../../server/db/index';
import * as materialsSvc from '../../server/services/materials';
import * as classesSvc from '../../server/services/classes';
import { MaterialInput } from '../../shared/schemas';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const [materials, classes] = await Promise.all([materialsSvc.list(db), classesSvc.listLite(db)]);
  return { materials, classes };
}

function preprocessMatRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (typeof out.favorite === 'string') out.favorite = out.favorite === 'true';
  return out;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await materialsSvc.remove(db, id);
    return { ok: true };
  }

  const raw = preprocessMatRaw(Object.fromEntries(formData) as Record<string, unknown>);

  if (intent === 'create') {
    const parsed = MaterialInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await materialsSvc.create(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = MaterialInput.partial().safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await materialsSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Materials() {
  return <MaterialsScreen />;
}
