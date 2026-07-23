import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { MaterialsScreen } from '../../src/screens-extra.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaff } from '../../server/services/auth';
import * as materialsSvc from '../../server/services/materials';
import type { MaterialRow } from '../../server/services/materials';
import * as classesSvc from '../../server/services/classes';
import { MaterialInput, parsePatch } from '../../shared/schemas';
import { cacheGet, cacheSet, invalidate } from '../../src/lib/cache.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const CACHE_KEY = 'route:materials';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireStaff(request, env);
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
  await requireStaff(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await materialsSvc.remove(db, id, env.FILES);
    return { ok: true, deletedId: id };
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
    const material = await materialsSvc.create(db, parsed.data, file, env.FILES);
    return { ok: true, material };
  }

  if (intent === 'update') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    const parsed = parsePatch(MaterialInput, raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const material = await materialsSvc.update(db, id, parsed.data, file, env.FILES);
    return { ok: true, material };
  }

  return Response.json({ error: 'unknown intent' }, { status: 400 });
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const cached = cacheGet<Awaited<ReturnType<typeof loader>>>(CACHE_KEY);
  let data: Awaited<ReturnType<typeof serverAction>>;
  try {
    data = await serverAction();
  } finally {
    invalidate('route:', 'evmat:');
  }
  // Write the mutated row back into the materials route cache so the
  // post-action revalidation is a cache hit instead of a second server
  // round-trip (the download button depends on the fresh fileKey).
  const result = data as {
    ok?: boolean;
    material?: MaterialRow;
    deletedId?: string;
  } | null;
  if (cached && result?.ok) {
    if (result.material) {
      const row = result.material;
      const exists = cached.materials.some((m) => m.id === row.id);
      const materials = exists
        ? cached.materials.map((m) => (m.id === row.id ? row : m))
        : [...cached.materials, row];
      cacheSet(CACHE_KEY, { ...cached, materials });
    } else if (result.deletedId) {
      const materials = cached.materials.filter((m) => m.id !== result.deletedId);
      cacheSet(CACHE_KEY, { ...cached, materials });
    }
  }
  return data;
}

export default function Materials() {
  return <MaterialsScreen />;
}
