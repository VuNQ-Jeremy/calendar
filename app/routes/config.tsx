import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { SystemConfigScreen } from '../../src/screens-config.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import * as typesSvc from '../../server/services/assessment-types';
import * as uiPrefsSvc from '../../server/services/ui-prefs';
import {
  AssessmentTypeInput,
  AssessmentTypeReorder,
  UiPrefsInput,
  parsePatch,
} from '../../shared/schemas';
import { cacheGet, cacheSet, invalidate } from '../../src/lib/cache.js';

const CACHE_KEY = 'route:config';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const [types, uiPrefs] = await Promise.all([typesSvc.list(db), uiPrefsSvc.getUiPrefs(db)]);
  return { types, uiPrefs };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  const cached = cacheGet<Awaited<ReturnType<typeof loader>>>(CACHE_KEY);
  if (cached !== undefined) return cached;
  const data = await serverLoader();
  cacheSet(CACHE_KEY, data);
  return data;
}

function preprocessRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (out.sortOrder === '') delete out.sortOrder;
  if (typeof out.active === 'string') out.active = out.active === 'true';
  return out;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  const raw = preprocessRaw(Object.fromEntries(formData) as Record<string, unknown>);

  try {
    if (intent === 'create-type') {
      const parsed = AssessmentTypeInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await typesSvc.create(db, parsed.data);
      return { ok: true };
    }

    if (intent === 'update-type') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const parsed = parsePatch(AssessmentTypeInput, raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await typesSvc.update(db, id, parsed.data);
      return { ok: true };
    }

    if (intent === 'delete-type') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await typesSvc.remove(db, id);
      return { ok: true };
    }

    if (intent === 'reorder-types') {
      let ids: unknown;
      try {
        ids = JSON.parse((formData.get('ids') as string) ?? '');
      } catch {
        return Response.json({ error: 'invalid ids' }, { status: 400 });
      }
      const parsed = AssessmentTypeReorder.safeParse({ ids });
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await typesSvc.reorder(db, parsed.data.ids);
      return { ok: true };
    }

    if (intent === 'ui-prefs') {
      const parsed = UiPrefsInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      const uiPrefs = await uiPrefsSvc.setUiPrefs(db, parsed.data);
      return { ok: true, uiPrefs };
    }
  } catch {
    return Response.json({ error: 'duplicate' }, { status: 400 });
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

export default function Config() {
  return <SystemConfigScreen />;
}
