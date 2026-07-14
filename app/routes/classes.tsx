import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { ClassesScreen } from '../../src/screens-manage/index.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as materialsSvc from '../../server/services/materials';
import * as homeworkSvc from '../../server/services/homework';
import { ClassInput } from '../../shared/schemas';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = createDb(context.get(cloudflareCtx).env);
  const [classes, students, materials, homework] = await Promise.all([
    classesSvc.list(db),
    peopleSvc.listStudents(db),
    materialsSvc.list(db),
    homeworkSvc.list(db),
  ]);
  return { classes, students, materials, homework };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const db = createDb(context.get(cloudflareCtx).env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await classesSvc.remove(db, id);
    return { ok: true };
  }

  const studentIdsRaw = formData.get('studentIds') as string | null;
  const raw = {
    ...Object.fromEntries(formData),
    studentIds: studentIdsRaw ? (JSON.parse(studentIdsRaw) as string[]) : [],
  };

  if (intent === 'create') {
    const parsed = ClassInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await classesSvc.create(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = ClassInput.partial().safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await classesSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export default function Classes() {
  return <ClassesScreen />;
}
