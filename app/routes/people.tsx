import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { StudentsScreen } from '../../src/screens-manage/index.jsx';
import { createDb } from '../../server/db/index';
import * as peopleSvc from '../../server/services/people';
import * as invitesSvc from '../../server/services/invites';
import * as classesSvc from '../../server/services/classes';
import { StudentInput, StaffInput, ParentInput, InviteInput } from '../../shared/schemas';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const [students, staff, parents, invites, classes] = await Promise.all([
    peopleSvc.listStudents(db),
    peopleSvc.listStaff(db),
    peopleSvc.listParents(db),
    invitesSvc.list(db),
    classesSvc.listLite(db),
  ]);
  return { students, staff, parents, invites, classes };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const db = createDb(context.cloudflare.env);
  const formData = await request.formData();
  const entity = formData.get('entity') as string;
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (entity === 'student') {
    if (intent === 'delete') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await peopleSvc.removeStudent(db, id);
      return { ok: true };
    }
    const classIdsRaw = formData.get('classIds') as string | null;
    const raw = {
      ...Object.fromEntries(formData),
      classIds: classIdsRaw ? (JSON.parse(classIdsRaw) as string[]) : [],
    };
    if (intent === 'create') {
      const parsed = StudentInput.safeParse(raw);
      if (!parsed.success)
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      await peopleSvc.createStudent(db, parsed.data);
      return { ok: true };
    }
    if (intent === 'update') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const parsed = StudentInput.partial().safeParse(raw);
      if (!parsed.success)
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      await peopleSvc.updateStudent(db, id, parsed.data);
      return { ok: true };
    }
  }

  if (entity === 'staff') {
    if (intent === 'delete') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await peopleSvc.removeStaff(db, id);
      return { ok: true };
    }
    const raw = Object.fromEntries(formData);
    if (intent === 'create') {
      const parsed = StaffInput.safeParse(raw);
      if (!parsed.success)
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      await peopleSvc.createStaff(db, parsed.data);
      return { ok: true };
    }
    if (intent === 'update') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const parsed = StaffInput.partial().safeParse(raw);
      if (!parsed.success)
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      await peopleSvc.updateStaff(db, id, parsed.data);
      return { ok: true };
    }
  }

  if (entity === 'parent') {
    if (intent === 'delete') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await peopleSvc.removeParent(db, id);
      return { ok: true };
    }
    const studentIdsRaw = formData.get('studentIds') as string | null;
    const raw = {
      ...Object.fromEntries(formData),
      studentIds: studentIdsRaw ? (JSON.parse(studentIdsRaw) as string[]) : [],
    };
    if (intent === 'create') {
      const parsed = ParentInput.safeParse(raw);
      if (!parsed.success)
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      await peopleSvc.createParent(db, parsed.data);
      return { ok: true };
    }
    if (intent === 'update') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const parsed = ParentInput.partial().safeParse(raw);
      if (!parsed.success)
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      await peopleSvc.updateParent(db, id, parsed.data);
      return { ok: true };
    }
  }

  if (entity === 'invite') {
    if (intent === 'delete') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await invitesSvc.remove(db, id);
      return { ok: true };
    }
    if (intent === 'create') {
      const raw = Object.fromEntries(formData);
      const parsed = InviteInput.safeParse(raw);
      if (!parsed.success)
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      await invitesSvc.create(db, parsed.data);
      return { ok: true };
    }
  }

  return Response.json({ error: 'unknown entity/intent' }, { status: 400 });
}

export default function People() {
  return <StudentsScreen />;
}
