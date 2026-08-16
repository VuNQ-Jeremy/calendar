import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as classMaterialsSvc from '../../server/services/class-materials';
import { ClassMaterialsSaveInput } from '../../shared/schemas';
import { invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const classId = new URL(request.url).searchParams.get('classId');
  if (!classId) return Response.json({ error: 'missing params' }, { status: 400 });
  const materialIds = await classMaterialsSvc.listForClass(db, classId);
  return { materialIds };
}

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const formData = await request.formData();

  if (formData.get('intent') !== 'save') {
    return Response.json({ error: 'unknown intent' }, { status: 400 });
  }

  let idsRaw: unknown;
  try {
    idsRaw = JSON.parse((formData.get('materialIds') as string) ?? '[]');
  } catch {
    return Response.json({ error: 'bad materialIds json' }, { status: 400 });
  }

  const parsed = ClassMaterialsSaveInput.safeParse({
    classId: formData.get('classId'),
    materialIds: idsRaw,
  });
  if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });

  const materialIds = await classMaterialsSvc.setForClass(
    db,
    parsed.data.classId,
    parsed.data.materialIds,
  );
  return { ok: true, materialIds };
}

export const action = withLiveAction('materials', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    // The 'materials' domain hard-drops the 'evmat:' joins and stales dashboard/calendar/classes —
    // exactly the loaders that now read class_materials.
    invalidateAfterMutation('materials');
  }
}
