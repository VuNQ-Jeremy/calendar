import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { FlashcardTopicsScreen } from '../../src/flashcards/index.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser, requireStaff } from '../../server/services/auth';
import * as flashcardsSvc from '../../server/services/flashcards';
import {
  FlashcardTopicInput,
  FlashcardTopicWithWordsInput,
  parsePatch,
} from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { kind } = await requireUser(request, env);
  const db = createDb(env);
  const topics = await flashcardsSvc.listTopics(db);
  // Gates the AI generator in the UI — same flag the topic page passes down.
  return { topics, kind, canTranslate: Boolean(env.ANTHROPIC_API_KEY) };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.flashcards, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env); // topic CRUD is staff-only
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await flashcardsSvc.removeTopic(db, id);
    return { ok: true };
  }

  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  if (raw.description === '') raw.description = null;

  if (intent === 'create') {
    const parsed = FlashcardTopicInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await flashcardsSvc.createTopic(db, parsed.data);
    return { ok: true };
  }

  // AI generation: the words were reviewed client-side, so the topic and its words are written
  // together — a failure can't leave an empty topic behind. Returns the slug so the screen can
  // navigate straight into the new topic.
  if (intent === 'generate-topic') {
    try {
      raw.words = JSON.parse((formData.get('words') as string) ?? '[]');
    } catch {
      return Response.json({ error: 'invalid words json' }, { status: 400 });
    }
    const parsed = FlashcardTopicWithWordsInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const { words, ...topic } = parsed.data;
    const created = await flashcardsSvc.createTopicWithWords(db, topic, words);
    return { ok: true, topic: created };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(FlashcardTopicInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await flashcardsSvc.updateTopic(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('flashcards');
  }
}

export default function Flashcards() {
  return <FlashcardTopicsScreen />;
}
