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
import { FlashcardTopicInput, parsePatch } from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const { kind } = await requireUser(request, env);
  const db = createDb(env);
  const topics = await flashcardsSvc.listTopics(db);
  return { topics, kind };
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
