import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { TestsScreen } from '../../src/tests/index.jsx';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as testsSvc from '../../server/services/tests';
import * as classesSvc from '../../server/services/classes';
import * as glSvc from '../../server/services/grade-levels';
import * as typesSvc from '../../server/services/assessment-types';
import { TestInput, parsePatch } from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const session = await requireStaff(request, env);
  const db = tenantDbFor(env, session);
  const [tests, links, classes, gradeLevels, types, summary] = await Promise.all([
    testsSvc.list(db),
    testsSvc.listQuestionLinks(db),
    classesSvc.list(db),
    glSvc.list(db),
    typesSvc.list(db),
    testsSvc.attemptsSummary(db),
  ]);
  return { tests, links, classes, gradeLevels, types, summary };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.tests, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

/**
 * FormData sends every absent optional as ''. The nullable columns want an explicit null.
 * `timeLimitMinutes` is nullish-wrapped, so null short-circuits before z.coerce.number()
 * gets a chance to turn '' into 0 (which would fail its min) — and mapping it to null
 * rather than dropping the key is what lets a teacher clear a limit they already set.
 */
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

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const session = await requireStaff(request, env);
  const db = tenantDbFor(env, session);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  // The service throws Responses (404 test_not_found, 400 test_empty/test_no_close,
  // 409 test_has_attempts). Catch and return them so `fetcher.data.error` is readable.
  try {
    if (intent === 'delete') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await testsSvc.remove(db, id);
      return { ok: true };
    }

    if (intent === 'publish' || intent === 'unpublish') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const test =
        intent === 'publish' ? await testsSvc.publish(db, id) : await testsSvc.unpublish(db, id);
      return { ok: true, test };
    }

    const raw = preprocessTestRaw(Object.fromEntries(formData) as Record<string, unknown>);

    if (intent === 'create') {
      const parsed = TestInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ error: 'invalid', errors: parsed.error.flatten() }, { status: 400 });
      }
      const test = await testsSvc.create(db, parsed.data);
      return { ok: true, test };
    }

    if (intent === 'update') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
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

export const action = withLiveAction('tests', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('tests');
  }
}

export default function Tests() {
  return <TestsScreen />;
}
