import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { FlashcardTopicScreen } from '../../src/flashcards/topic.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as flashcardsSvc from '../../server/services/flashcards';
import {
  FlashcardWordInput,
  FlashcardImportInput,
  FlashcardResultInput,
  parsePatch,
} from '../../shared/schemas';
import { cacheGet, cacheSet, invalidate } from '../../src/lib/cache.js';

const keyFor = (topicId: string) => `route:flashcards:${topicId}`;

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const su = await requireUser(request, env);
  const db = createDb(env);
  const topicId = params.topicId!;
  const topic = await flashcardsSvc.getTopic(db, topicId);
  if (!topic) throw new Response('Not found', { status: 404 });
  const [words, results, mastery] = await Promise.all([
    flashcardsSvc.listWords(db, topicId),
    flashcardsSvc.listTopicResults(db, topicId),
    su.kind === 'student'
      ? flashcardsSvc.listMasteryForStudent(db, su.user.id, topicId)
      : Promise.resolve([]),
  ]);
  return { topic, words, results, mastery, kind: su.kind };
}

export async function clientLoader({ serverLoader, params }: ClientLoaderFunctionArgs) {
  const cacheKey = keyFor(params.topicId!);
  const cached = cacheGet<Awaited<ReturnType<typeof loader>>>(cacheKey);
  if (cached !== undefined) return cached;
  const data = await serverLoader();
  cacheSet(cacheKey, data);
  return data;
}

function preprocessWord(raw: Record<string, unknown>) {
  const out = { ...raw };
  for (const k of ['definitionEn', 'ipa', 'audioUrl'] as const) {
    if (out[k] === '') out[k] = null;
  }
  delete out.intent;
  delete out.id;
  return out;
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const su = await requireUser(request, env);
  const db = createDb(env);
  const topicId = params.topicId!;
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  const staffOnly = () =>
    su.kind !== 'staff' ? Response.json({ error: 'forbidden' }, { status: 403 }) : null;

  if (intent === 'word-create') {
    const forbidden = staffOnly();
    if (forbidden) return forbidden;
    const parsed = FlashcardWordInput.safeParse(
      preprocessWord(Object.fromEntries(formData) as Record<string, unknown>),
    );
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await flashcardsSvc.createWord(db, topicId, parsed.data);
    return { ok: true };
  }

  if (intent === 'word-update') {
    const forbidden = staffOnly();
    if (forbidden) return forbidden;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(
      FlashcardWordInput,
      preprocessWord(Object.fromEntries(formData) as Record<string, unknown>),
    );
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await flashcardsSvc.updateWord(db, id, parsed.data);
    return { ok: true };
  }

  if (intent === 'word-delete') {
    const forbidden = staffOnly();
    if (forbidden) return forbidden;
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await flashcardsSvc.removeWord(db, id);
    return { ok: true };
  }

  if (intent === 'words-import') {
    const forbidden = staffOnly();
    if (forbidden) return forbidden;
    let payload: unknown;
    try {
      payload = { words: JSON.parse((formData.get('words') as string) ?? '[]') };
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    const parsed = FlashcardImportInput.safeParse(payload);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await flashcardsSvc.importWords(db, topicId, parsed.data.words);
    return { ok: true };
  }

  if (intent === 'record-result') {
    if (su.kind !== 'student') return { ok: true, preview: true };
    let answers: unknown = [];
    try {
      answers = JSON.parse((formData.get('answers') as string) ?? '[]');
    } catch {
      answers = [];
    }
    const parsed = FlashcardResultInput.safeParse({
      topicId: formData.get('topicId'),
      mode: formData.get('mode'),
      score: formData.get('score'),
      total: formData.get('total'),
      durationMs: formData.get('durationMs'),
      answers,
    });
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    if (parsed.data.topicId !== topicId) {
      return Response.json({ error: 'topic mismatch' }, { status: 400 });
    }
    await flashcardsSvc.recordResult(db, su.user.id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidate('route:flashcards');
  }
}

export default function FlashcardTopic() {
  return <FlashcardTopicScreen />;
}
