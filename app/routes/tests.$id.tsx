import { redirect } from 'react-router';
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { TestDetailScreen } from '../../src/tests/test-detail.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as testsSvc from '../../server/services/tests';
import * as attemptsSvc from '../../server/services/attempts';
import * as questionsSvc from '../../server/services/questions';
import * as classesSvc from '../../server/services/classes';
import * as peopleSvc from '../../server/services/people';
import * as glSvc from '../../server/services/grade-levels';
import * as typesSvc from '../../server/services/assessment-types';
import {
  TestInput,
  TestQuestionsSaveInput,
  PaperScoresSaveInput,
  AttemptGradeInput,
  parsePatch,
} from '../../shared/schemas';
import { testDetailKey, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const id = params.id!;
  const test = await testsSvc.get(db, id);
  const [links, questions, allStudents, attempts, classes, gradeLevels, types, totalPoints] =
    await Promise.all([
      testsSvc.listQuestionLinks(db, id),
      questionsSvc.list(db),
      peopleSvc.listStudents(db),
      testsSvc.listAttempts(db, id),
      classesSvc.list(db),
      glSvc.list(db),
      typesSvc.list(db),
      testsSvc.totalPoints(db, id),
    ]);

  // Roster of the test's class, in the class's own student order
  // (ClassRow.studentIds joined against the student records).
  const cls = test.classId ? classes.find((c) => c.id === test.classId) : undefined;
  const students = (cls?.studentIds ?? [])
    .map((sid) => allStudents.find((s) => s.id === sid))
    .filter((s): s is (typeof allStudents)[number] => !!s);

  // Every attempt's answers up front: the grading modal opens on a row that is already loaded, so
  // fetching per attempt would cost a round-trip per click for data we can bring along here.
  const answers = (
    await Promise.all(attempts.map((a) => attemptsSvc.listAnswers(db, a.id)))
  ).flat();

  return {
    test,
    links,
    questions,
    students,
    attempts,
    answers,
    classes,
    gradeLevels,
    types,
    totalPoints,
  };
}

export async function clientLoader({ serverLoader, params }: ClientLoaderFunctionArgs) {
  return swrLoad(
    testDetailKey(params.id!),
    () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>,
  );
}
clientLoader.hydrate = true as const;

function preprocessTestRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  for (const k of [
    'classId',
    'assessmentTypeId',
    'gradeLevelId',
    'date',
    'openAt',
    'closeAt',
    'instructions',
    'color',
    'timeLimitMinutes',
  ] as const) {
    if (out[k] === '') out[k] = null;
  }
  return out;
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
  const db = createDb(env);
  const id = params.id!;
  const formData = await request.formData();
  const intent = formData.get('intent') as string;

  // The service throws Responses (404 test_not_found, 400 test_empty/test_no_close/
  // unknown_question, 409 test_has_attempts). Catch and return them so the client can
  // read `fetcher.data.error` instead of hitting an error boundary.
  try {
    if (intent === 'delete') {
      await testsSvc.remove(db, id);
      return redirect('/tests');
    }

    if (intent === 'publish' || intent === 'unpublish') {
      const test =
        intent === 'publish' ? await testsSvc.publish(db, id) : await testsSvc.unpublish(db, id);
      return { ok: true, test };
    }

    if (intent === 'save-questions') {
      let itemsRaw: unknown;
      try {
        itemsRaw = JSON.parse((formData.get('items') as string) ?? '[]');
      } catch {
        return Response.json({ error: 'bad items json' }, { status: 400 });
      }
      const parsed = TestQuestionsSaveInput.safeParse({ testId: id, items: itemsRaw });
      if (!parsed.success) {
        return Response.json({ error: 'invalid', errors: parsed.error.flatten() }, { status: 400 });
      }
      const links = await testsSvc.setQuestions(db, id, parsed.data.items);
      return { ok: true, links };
    }

    if (intent === 'save-paper-scores') {
      let recordsRaw: unknown;
      try {
        recordsRaw = JSON.parse((formData.get('records') as string) ?? '[]');
      } catch {
        return Response.json({ error: 'bad records json' }, { status: 400 });
      }
      const parsed = PaperScoresSaveInput.safeParse({ testId: id, records: recordsRaw });
      if (!parsed.success) {
        return Response.json({ error: 'invalid', errors: parsed.error.flatten() }, { status: 400 });
      }
      const { attempts, skipped } = await testsSvc.savePaperScores(db, id, parsed.data.records);
      return { ok: true, attempts, skipped };
    }

    // Teacher grading of an online attempt. The grades array travels as JSON in `payload`
    // because a FormData field cannot carry a nested list.
    if (intent === 'grade-attempt') {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse((formData.get('payload') as string) ?? '{}') as Record<
          string,
          unknown
        >;
      } catch {
        return Response.json({ error: 'bad payload json' }, { status: 400 });
      }
      const parsed = AttemptGradeInput.safeParse({
        attemptId: formData.get('attemptId'),
        grades: payload.grades,
        normalizedOverride: payload.normalizedOverride,
        comment: payload.comment,
      });
      if (!parsed.success) {
        return Response.json({ error: 'invalid', errors: parsed.error.flatten() }, { status: 400 });
      }
      const attempt = await attemptsSvc.grade(db, parsed.data.attemptId, parsed.data);
      return { ok: true, attempt };
    }

    // "Allow retake": drops the attempt, its answers and its gradebook row.
    if (intent === 'reset-attempt') {
      const attemptId = (formData.get('attemptId') as string) ?? '';
      if (!attemptId) return Response.json({ error: 'invalid' }, { status: 400 });
      await attemptsSvc.reset(db, attemptId);
      return { ok: true };
    }

    if (intent === 'update') {
      const raw = preprocessTestRaw(Object.fromEntries(formData) as Record<string, unknown>);
      const parsed = parsePatch(TestInput, raw);
      if (!parsed.success) {
        return Response.json({ error: 'invalid', errors: parsed.error.flatten() }, { status: 400 });
      }
      const test = await testsSvc.update(db, id, parsed.data);
      return { ok: true, test };
    }
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('tests');
  }
}

export default function TestDetail() {
  return <TestDetailScreen />;
}
