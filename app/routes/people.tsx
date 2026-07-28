import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { StudentsScreen } from '../../src/screens-manage/index.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as peopleSvc from '../../server/services/people';
import * as invitesSvc from '../../server/services/invites';
import * as classesSvc from '../../server/services/classes';
import * as flashcardsSvc from '../../server/services/flashcards';
import {
  StudentInput,
  StaffInput,
  ParentInput,
  InviteInput,
  parsePatch,
} from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const [students, staff, parents, invites, classes, flashcardStats] = await Promise.all([
    peopleSvc.listStudents(db),
    peopleSvc.listStaff(db),
    peopleSvc.listParents(db),
    invitesSvc.list(db),
    classesSvc.listLite(db),
    flashcardsSvc.studentFlashcardStats(db),
  ]);
  return { students, staff, parents, invites, classes, flashcardStats };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.people, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
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
      const parsed = parsePatch(StudentInput, raw);
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
      const parsed = parsePatch(StaffInput, raw);
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
      const parsed = parsePatch(ParentInput, raw);
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('people');
  }
}

export default function People() {
  return <StudentsScreen />;
}
