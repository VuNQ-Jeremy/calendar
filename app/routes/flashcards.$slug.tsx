import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { FlashcardTopicScreen } from '../../src/flashcards/topic.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireLearner } from '../../server/services/auth';
import * as flashcardsSvc from '../../server/services/flashcards';
import * as gardenSvc from '../../server/services/garden';
import {
  FlashcardWordInput,
  FlashcardImportInput,
  FlashcardExampleFillInput,
  FlashcardResultInput,
  parsePatch,
} from '../../shared/schemas';
import { ictDateOf } from '../../shared/logic/tests';
import { invalidate, markStale } from '../../src/lib/cache.js';
import { K, flashcardTopicKey, swrLoad } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const su = await requireLearner(request, env);
  const db = createDb(env);
  const topic = await flashcardsSvc.getTopicBySlug(db, params.slug!);
  if (!topic) throw new Response('Not found', { status: 404 });
  const [words, results, mastery] = await Promise.all([
    flashcardsSvc.listWords(db, topic.id),
    flashcardsSvc.listTopicResults(db, topic.id),
    su.kind === 'student'
      ? flashcardsSvc.listMasteryForStudent(db, su.user.id, topic.id)
      : Promise.resolve([]),
  ]);
  // The earliest-deadline open assignment for this topic pins the round size and the mix pool.
  // Same degrade-to-null contract as the garden on /vocabulary: a deploy racing its migration
  // must not take the topic page down.
  let assignment: { questionCount: number | null; modes: string | null } | null = null;
  if (su.kind === 'student') {
    try {
      const all = await gardenSvc.studentAssignments(db, su.user.id, new Date().toISOString());
      const hit = all.find((a) => a.topicId === topic.id) ?? null; // already deadline-ascending
      assignment = hit ? { questionCount: hit.questionCount, modes: hit.modes } : null;
    } catch (err) {
      console.error('assignment pin unavailable on topic page', err);
    }
  }
  return {
    topic,
    words,
    results,
    mastery,
    kind: su.kind,
    canUseAi: Boolean(env.ANTHROPIC_API_KEY),
    assignment,
    // ICT today, from the server, so `?review=1` picks the same due words the vocabulary page
    // counted — a device clock set abroad must not shift the deck by a day.
    today: ictDateOf(new Date().toISOString()),
  };
}

export async function clientLoader({ serverLoader, params }: ClientLoaderFunctionArgs) {
  return swrLoad(
    flashcardTopicKey(params.slug!),
    () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>,
  );
}
clientLoader.hydrate = true as const;

function preprocessWord(raw: Record<string, unknown>) {
  const out = { ...raw };
  // A cleared field arrives as '' rather than as a missing key, which every one of these
  // `.nullish()` schemas would reject — imageKey especially, since it is regex-checked.
  for (const k of [
    'definitionEn',
    'ipa',
    'exampleEn',
    'exampleAnswer',
    'audioUrl',
    'imageKey',
  ] as const) {
    if (out[k] === '') out[k] = null;
  }
  delete out.intent;
  delete out.id;
  return out;
}

async function actionImpl({ request, params, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const su = await requireLearner(request, env);
  const db = createDb(env);
  const topic = await flashcardsSvc.getTopicBySlug(db, params.slug!);
  if (!topic) throw new Response('Not found', { status: 404 });
  const topicId = topic.id;
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

  if (intent === 'words-example-fill') {
    const forbidden = staffOnly();
    if (forbidden) return forbidden;
    let payload: unknown;
    try {
      payload = { items: JSON.parse((formData.get('items') as string) ?? '[]') };
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    const parsed = FlashcardExampleFillInput.safeParse(payload);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await flashcardsSvc.updateWordExamples(db, topicId, parsed.data.items);
    return { ok: true };
  }

  if (intent === 'record-result') {
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
    // The garden outcome rides back with the result so the end-of-round panel can say what
    // happened to the plant without a second round trip. It is null for a staff preview and for a
    // round that was already recorded (an offline flush), and the games then say nothing.
    const { garden } = await flashcardsSvc.recordResultWithGarden(
      db,
      { kind: su.kind, id: su.user.id },
      parsed.data,
    );
    return { ok: true, garden };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export const action = withLiveAction('flashcards', actionImpl);

export async function clientAction({ serverAction, params }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidate(flashcardTopicKey(params.slug!));
    // topic list shows word counts; people shows per-student flashcard stats.
    // NOTE markStale is prefix-based like invalidate, so K.flashcards
    // ('route:flashcards') also stales every OTHER cached topic page
    // ('route:flashcards:<slug>') — intended, they share mastery/stats.
    markStale(K.flashcards, K.people);
  }
}

export default function FlashcardTopic() {
  return <FlashcardTopicScreen />;
}
