import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { MaterialsScreen } from '../../src/screens-extra.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser } from '../../server/services/auth';
import * as materialsSvc from '../../server/services/materials';
import * as classesSvc from '../../server/services/classes';
import { MaterialInput, parsePatch } from '../../shared/schemas';
import { cacheGet, cacheSet, invalidate } from '../../src/lib/cache.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const CACHE_KEY = 'route:materials';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireUser(request, env);
  const db = createDb(env);
  const [materials, classes] = await Promise.all([materialsSvc.list(db), classesSvc.listLite(db)]);
  return { materials, classes };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const cached = cacheGet<Awaited<ReturnType<typeof loader>>>(CACHE_KEY);
  if (cached !== undefined) return cached;
  const data = await serverLoader();
  cacheSet(CACHE_KEY, data);
  return data;
}

function preprocessMatRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (typeof out.favorite === 'string') out.favorite = out.favorite === 'true';
  if (out.classId === '') out.classId = null;
  return out;
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
    await materialsSvc.remove(db, id, env.FILES);
    return { ok: true };
  }

  // Extract file upload if present
  const fileRaw = formData.get('file');
  const file = fileRaw instanceof File && fileRaw.size > 0 ? fileRaw : undefined;

  if (file && file.size > MAX_FILE_SIZE) {
    return Response.json(
      { errors: { fieldErrors: { file: ['File exceeds 20 MB limit'] } } },
      { status: 400 },
    );
  }

  const raw = preprocessMatRaw(Object.fromEntries(formData) as Record<string, unknown>);
  // Remove the file entry from raw so it doesn't interfere with schema validation
  delete (raw as Record<string, unknown>).file;

  if (intent === 'create') {
    const parsed = MaterialInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await materialsSvc.create(db, parsed.data, file, env.FILES);
    return { ok: true };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(MaterialInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    await materialsSvc.update(db, id, parsed.data, file, env.FILES);
    return { ok: true };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidate('route:', 'evmat:');
  }
}

export default function Materials() {
  return <MaterialsScreen />;
}
