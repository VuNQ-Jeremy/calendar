import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { SystemConfigScreen } from '../../src/screens-config.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import * as typesSvc from '../../server/services/assessment-types';
import { AssessmentTypeInput } from '../../shared/schemas';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const types = await typesSvc.list(db);
  return { types };
}

function preprocessRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (out.sortOrder === '') delete out.sortOrder;
  if (typeof out.active === 'string') out.active = out.active === 'true';
  return out;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  const raw = preprocessRaw(Object.fromEntries(formData) as Record<string, unknown>);

  try {
    if (intent === 'create-type') {
      const parsed = AssessmentTypeInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await typesSvc.create(db, parsed.data);
      return { ok: true };
    }

    if (intent === 'update-type') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const parsed = AssessmentTypeInput.partial().safeParse(raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await typesSvc.update(db, id, parsed.data);
      return { ok: true };
    }
  } catch {
    return Response.json({ error: 'duplicate' }, { status: 400 });
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Config() {
  return <SystemConfigScreen />;
}
