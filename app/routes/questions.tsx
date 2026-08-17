import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { QuestionBankScreen } from '../../src/tests/question-bank.jsx';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as questionsSvc from '../../server/services/questions';
import * as gradeLevelsSvc from '../../server/services/grade-levels';
import {
  QuestionInput,
  QuestionInputBase,
  QuestionsImportInput,
  QuestionsBulkDeleteInput,
  QuestionsBulkMetaInput,
  QuestionsBulkTagsInput,
  parsePatch,
} from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const session = await requireStaff(request, env);
  const db = tenantDbFor(env, session);
  const [questions, gradeLevels, usage] = await Promise.all([
    questionsSvc.list(db),
    gradeLevelsSvc.list(db),
    questionsSvc.usageCounts(db),
  ]);
  return { questions, gradeLevels, usage };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.questions, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

/**
 * The three JSON-shaped fields ride through FormData as strings. An ABSENT or empty string must
 * leave the key off the object entirely — `parsePatch` keys off `Object.hasOwn`, so a present-but-
 * undefined key would be treated as an intentional change.
 */
function preprocessQRaw(raw: Record<string, unknown>): Record<string, unknown> | null {
  const out = { ...raw };
  for (const k of ['tags', 'options', 'answerKey'] as const) {
    const v = out[k];
    if (v === undefined || v === '') {
      delete out[k];
      continue;
    }
    try {
      out[k] = JSON.parse(v as string);
    } catch {
      return null;
    }
  }
  if (out.gradeLevelId === '') out.gradeLevelId = null;
  if (out.context === '') out.context = null;
  if (out.difficulty === '') out.difficulty = null;
  if (out.explanation === '') out.explanation = null;
  return out;
}

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const session = await requireStaff(request, env);
  const db = tenantDbFor(env, session);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  // The service throws Responses (409 question_locked / question_in_use, 400 with Zod issues).
  // Catch and return them so `fetcher.data.error` is readable on the client instead of the
  // mutation blowing up into an error boundary.
  try {
    if (intent === 'delete') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await questionsSvc.remove(db, id);
      return { ok: true };
    }

    /**
     * Empties the whole bank, detaching every question from every test and cascading away each
     * student's stored answers. Deliberately payload-free: there is nothing to get wrong, and the
     * only guard that matters is the confirmation the UI puts in front of it.
     */
    if (intent === 'wipe') {
      return { ok: true, ...(await questionsSvc.wipe(db)) };
    }

    // Bulk save from the file-import review screen, and the three bulk actions from the bank's
    // multi-select bar. All handled before `preprocessQRaw` because each rides as one `payload` JSON
    // string — there are no flat per-question fields to coerce.
    if (intent === 'import' || intent.startsWith('bulk-')) {
      let payload: unknown;
      try {
        payload = JSON.parse((formData.get('payload') as string) ?? '{}');
      } catch {
        return Response.json({ error: 'bad payload json' }, { status: 400 });
      }
      const invalid = (errors: unknown) =>
        Response.json({ error: 'invalid', errors }, { status: 400 });

      if (intent === 'import') {
        const parsed = QuestionsImportInput.safeParse(payload);
        if (!parsed.success) return invalid(parsed.error.flatten());
        const created = await questionsSvc.createMany(db, parsed.data.questions);
        return { ok: true, created: created.length };
      }

      if (intent === 'bulk-delete') {
        const parsed = QuestionsBulkDeleteInput.safeParse(payload);
        if (!parsed.success) return invalid(parsed.error.flatten());
        return { ok: true, ...(await questionsSvc.removeMany(db, parsed.data.ids)) };
      }

      if (intent === 'bulk-meta') {
        const parsed = QuestionsBulkMetaInput.safeParse(payload);
        if (!parsed.success) return invalid(parsed.error.flatten());
        const { ids, ...patch } = parsed.data;
        const updated = await questionsSvc.bulkSetMeta(db, ids, patch);
        return { ok: true, updated };
      }

      if (intent === 'bulk-tags') {
        const parsed = QuestionsBulkTagsInput.safeParse(payload);
        if (!parsed.success) return invalid(parsed.error.flatten());
        const updated = await questionsSvc.bulkAddTags(db, parsed.data.ids, parsed.data.tags);
        return { ok: true, updated };
      }
    }

    const raw = preprocessQRaw(Object.fromEntries(formData) as Record<string, unknown>);
    if (!raw) return Response.json({ error: 'bad json' }, { status: 400 });

    if (intent === 'create') {
      const parsed = QuestionInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ error: 'invalid', errors: parsed.error.flatten() }, { status: 400 });
      }
      await questionsSvc.create(db, parsed.data);
      return { ok: true };
    }

    if (intent === 'update') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const parsed = parsePatch(QuestionInputBase, raw);
      if (!parsed.success) {
        return Response.json({ error: 'invalid', errors: parsed.error.flatten() }, { status: 400 });
      }
      await questionsSvc.update(db, id, parsed.data);
      return { ok: true };
    }
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('questions', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('questions');
  }
}

export default function Questions() {
  return <QuestionBankScreen />;
}
