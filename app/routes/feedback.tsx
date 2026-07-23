import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { useOutletContext } from 'react-router';
import { FeedbackScreen } from '../../src/feedback.jsx';
import type { AppContext } from './_app.js';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as feedbackSvc from '../../server/services/feedback';
import { FeedbackInput, parsePatch } from '../../shared/schemas';
import { cacheGet, cacheSet, invalidate } from '../../src/lib/cache.js';

const CACHE_KEY = 'route:feedback';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const feedback = await feedbackSvc.list(db);
  return { feedback };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const cached = cacheGet<Awaited<ReturnType<typeof loader>>>(CACHE_KEY);
  if (cached !== undefined) return cached;
  const data = await serverLoader();
  cacheSet(CACHE_KEY, data);
  return data;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await feedbackSvc.remove(db, id);
    return { ok: true };
  }

  const raw = Object.fromEntries(formData);

  if (intent === 'create') {
    const parsed = FeedbackInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await feedbackSvc.create(db, parsed.data);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(FeedbackInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await feedbackSvc.update(db, id, parsed.data);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidate('route:');
  }
}

export default function Feedback() {
  const { user } = useOutletContext<AppContext>();
  return <FeedbackScreen user={user} />;
}
