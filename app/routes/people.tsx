import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { StudentsScreen } from '../../src/screens-manage/index.jsx';
import { tenantDbFor } from '../../server/db';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as peopleSvc from '../../server/services/people';
import * as invitesSvc from '../../server/services/invites';
import * as classesSvc from '../../server/services/classes';
import * as flashcardsSvc from '../../server/services/flashcards';
import {
  StudentInput,
  StudentCreateInput,
  StaffInput,
  ParentInput,
  parsePatch,
} from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requireStaff(request, env);
  const db = tenantDbFor(env, user);
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

/**
 * Creating a person mints their login code in the same round trip, so the modal can show
 * it instead of sending staff hunting through the Invites tab. The three service calls are
 * sequential rather than one batch: they reuse createStudent/createParent untouched. If the
 * code insert fails the person still exists without a code — delete and re-create.
 */
async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const user = await requireStaff(request, env);
  const db = tenantDbFor(env, user);
  const formData = await request.formData();
  const entity = formData.get('entity') as string;
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'reset-login') {
    // Admin-only: this destroys the person's current login entirely (see resetLogin's own
    // comment) — a plain Teacher/Assistant can edit a roster but must not revoke a colleague's
    // or a family's access.
    if (user.user.role !== 'Admin') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    // Resetting yourself deletes your own account mid-request: the session dies with it and the
    // replacement code is shown exactly once to a page you can no longer act from. Refuse — a
    // second Admin (or scripts/reset-password.mjs) is the path for this one person.
    if (entity === 'staff' && id === user.user.id) {
      return Response.json({ error: 'cannot_reset_self' }, { status: 400 });
    }
    const target =
      entity === 'student'
        ? ({ role: 'Student', studentId: id } as const)
        : entity === 'staff'
          ? ({ role: 'Staff', staffId: id } as const)
          : entity === 'parent'
            ? ({ role: 'Parent', parentId: id } as const)
            : null;
    if (!target) return Response.json({ error: 'unknown entity/intent' }, { status: 400 });
    const result = await invitesSvc.resetLogin(db, target);
    if (!result) return Response.json({ error: 'no_account' }, { status: 400 });
    return { ok: true, code: result.code };
  }

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
      const parsed = StudentCreateInput.safeParse(raw);
      if (!parsed.success)
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      const { parentId, parentName, parentRelation, parentPhone, ...studentInput } = parsed.data;
      // Reject a stale id before creating the student, so a failed link cannot leave a
      // half-done add behind.
      const existingParent = parentId ? await peopleSvc.findParent(db, parentId) : null;
      if (parentId && !existingParent) {
        return Response.json({ error: 'unknown parent' }, { status: 400 });
      }

      const student = await peopleSvc.createStudent(db, studentInput);
      const targets: invitesSvc.LinkedTarget[] = [{ role: 'Student', studentId: student.id }];

      if (existingParent) {
        await peopleSvc.linkParentToStudent(db, existingParent.id, student.id);
        // They usually have their code already; only mint one if they have neither that
        // nor an account — a parent who predates linked invites has neither.
        const target = { role: 'Parent', parentId: existingParent.id } as const;
        if (await invitesSvc.needsInvite(db, target)) targets.push(target);
      } else if (parentName?.trim()) {
        const parent = await peopleSvc.createParent(db, {
          name: parentName.trim(),
          email: null,
          phone: parentPhone ?? null,
          color: 'green',
          relation: parentRelation || 'Guardian',
          studentIds: [student.id],
        });
        targets.push({ role: 'Parent', parentId: parent.id });
      }
      const created = await invitesSvc.createLinked(db, targets);
      return { ok: true, invites: created.map((i) => ({ role: i.role, code: i.code })) };
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
      const created = await peopleSvc.createStaff(db, parsed.data);
      const codes = await invitesSvc.createLinked(db, [{ role: 'Staff', staffId: created.id }]);
      return { ok: true, invites: codes.map((i) => ({ role: i.role, code: i.code })) };
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
      const created = await peopleSvc.createParent(db, parsed.data);
      const codes = await invitesSvc.createLinked(db, [{ role: 'Parent', parentId: created.id }]);
      return { ok: true, invites: codes.map((i) => ({ role: i.role, code: i.code })) };
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

  // Only revoke: codes are minted by the create branches above, never by hand. The mobile
  // app still creates unlinked ones through /api/invites.
  if (entity === 'invite') {
    if (intent === 'delete') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await invitesSvc.remove(db, id);
      return { ok: true };
    }
  }

  return Response.json({ error: 'unknown entity/intent' }, { status: 400 });
}

export const action = withLiveAction('people', actionImpl);

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
