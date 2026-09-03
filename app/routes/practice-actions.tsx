import type { ActionFunctionArgs, ClientActionFunctionArgs } from 'react-router';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as practiceSvc from '../../server/services/practice';
import {
  parsePatch,
  PracticeClearWarningInput,
  PracticeDayOverrideInput,
  PracticeExcuseDecideInput,
  PracticeExcuseMissInput,
  PracticeQuickAddInput,
  PracticeReviewInput,
  PracticeSettingsInput,
  PracticeTaskInput,
} from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import { invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

/**
 * Cookie-authed action for every Practice mutation on the web.
 *
 * The `/api/practice/*` twins are bearer-only (the phone), so a browser `useFetcher` there gets a
 * 401 and a degrade-to-null screen hides it — the same trap `garden-month` and `report-extras`
 * exist to avoid. One route dispatching on `intent` rather than four, so a spec can arm a single
 * `posted('/practice-actions')` before any dialog submit. Any staff may act (decision #4).
 */
const bad = (error: string, status = 400) => Response.json({ error }, { status });

function formObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') o[k] = v;
  return o;
}

/**
 * A cleared `<select>` posts an empty string, and `materialId`/`studentId` are FOREIGN KEYS.
 * Zod is happy with `''` (it IS a string), the service's `?? null` does not catch it, and D1
 * then rejects the write with a constraint error the dialog shows as nothing at all. Blanks
 * become nulls here, once, rather than in each case below.
 */
function nullBlanks(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out = { ...o };
  for (const k of keys) if (out[k] === '') out[k] = null;
  return out;
}

async function actionImpl(args: ActionFunctionArgs) {
  try {
    return await dispatch(args);
  } catch (err) {
    // `requireStaff` signals "sign in first" by THROWING a redirect Response — swallowing that
    // would turn a logged-out POST into a 500 with no way back to /login.
    if (err instanceof Response) throw err;
    // A service throw here is a string code ('not_found', 'deadline_passed'). Turned into a
    // response rather than left to the error boundary: a fetcher POST that 500s takes down the
    // whole route, and the dialog that sent it has already closed.
    const code = err instanceof Error ? err.message : 'internal_error';
    console.error('[practice] action failed', { code });
    return Response.json({ error: code }, { status: code === 'not_found' ? 404 : 500 });
  }
}

async function dispatch({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);
  const fd = await request.formData();
  const intent = String(fd.get('intent') ?? '');
  const body = formObject(fd);
  const today = ictDateOf(new Date().toISOString());
  const staffId = staff.user.id;

  switch (intent) {
    case 'settings': {
      const p = PracticeSettingsInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      // `explicitWeekdays` false on a first enable is what makes the service derive Mon–Sat
      // minus this class's own lesson days instead of taking the schema default.
      return {
        ok: true,
        settings: await practiceSvc.saveSettings(db, p.data, today, fd.has('weekdays')),
      };
    }
    case 'day-override': {
      const p = PracticeDayOverrideInput.safeParse({
        ...body,
        isPractice: body.isPractice === 'null' ? null : body.isPractice,
      });
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.setOverride(db, p.data);
      return { ok: true };
    }
    case 'quick-add': {
      const p = PracticeQuickAddInput.safeParse(nullBlanks(body, ['materialId']));
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, tasks: await practiceSvc.quickAdd(db, p.data, staffId) };
    }
    case 'create-task': {
      const p = PracticeTaskInput.safeParse(nullBlanks(body, ['materialId', 'studentId', 'url']));
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, task: await practiceSvc.createTask(db, p.data, staffId) };
    }
    case 'update-task': {
      const id = String(fd.get('id') ?? '');
      if (!id) return bad('missing_id');
      const p = parsePatch(
        PracticeTaskInput.pick({ title: true, materialId: true, url: true, proofType: true }),
        nullBlanks(body, ['materialId', 'url']),
      );
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.updateTask(db, id, p.data);
      return { ok: true };
    }
    case 'delete-task': {
      const id = String(fd.get('id') ?? '');
      if (!id) return bad('missing_id');
      await practiceSvc.deleteTask(db, id);
      return { ok: true };
    }
    case 'remove-copy': {
      const id = String(fd.get('id') ?? '');
      if (!id) return bad('missing_id');
      await practiceSvc.removeStudentTask(db, id);
      return { ok: true };
    }
    case 'review': {
      const p = PracticeReviewInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, task: await practiceSvc.review(db, p.data, staffId) };
    }
    case 'excuse-decide': {
      const p = PracticeExcuseDecideInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      return { ok: true, excuse: await practiceSvc.decideExcuse(db, p.data, staffId) };
    }
    case 'excuse-miss': {
      const p = PracticeExcuseMissInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.excuseMiss(db, p.data, staffId);
      return { ok: true };
    }
    case 'clear-warning': {
      const p = PracticeClearWarningInput.safeParse(body);
      if (!p.success) return bad('validation_failed', 422);
      await practiceSvc.clearStudentWarning(db, p.data.classId, p.data.studentId, staffId);
      return { ok: true };
    }
    default:
      return bad('unknown intent');
  }
}

export const action = withLiveAction('practice', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('practice');
  }
}
