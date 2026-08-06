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
import * as criteriaSvc from '../../server/services/remark-criteria';
import * as levelsSvc from '../../server/services/grade-levels';
import * as uiPrefsSvc from '../../server/services/ui-prefs';
import * as tuitionSvc from '../../server/services/tuition';
import * as rankingsSvc from '../../server/services/rankings';
import {
  AssessmentTypeInput,
  AssessmentTypeReorder,
  GradeLevelInput,
  GradeLevelReorder,
  RankingWeightsInput,
  RemarkCriterionInput,
  RemarkCriteriaReorder,
  TuitionSettingsInput,
  UiPrefsInput,
  parsePatch,
} from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const [types, remarkCriteria, gradeLevels, uiPrefs, tuitionSettings, rankingWeights] =
    await Promise.all([
      typesSvc.list(db),
      criteriaSvc.list(db),
      levelsSvc.list(db),
      uiPrefsSvc.getUiPrefs(db),
      tuitionSvc.getTuitionSettings(db),
      rankingsSvc.getRankingWeights(db),
    ]);
  return { types, remarkCriteria, gradeLevels, uiPrefs, tuitionSettings, rankingWeights };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.config, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

function preprocessRaw(raw: Record<string, unknown>) {
  const out = { ...raw };
  if (out.sortOrder === '') delete out.sortOrder;
  if (typeof out.active === 'string') out.active = out.active === 'true';
  return out;
}

async function actionImpl({ request, context }: ActionFunctionArgs) {
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

    if (intent === 'create-criterion') {
      const parsed = RemarkCriterionInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await criteriaSvc.create(db, parsed.data);
      return { ok: true };
    }

    if (intent === 'update-criterion') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const parsed = parsePatch(RemarkCriterionInput, raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await criteriaSvc.update(db, id, parsed.data);
      return { ok: true };
    }

    if (intent === 'delete-criterion') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await criteriaSvc.remove(db, id);
      return { ok: true };
    }

    if (intent === 'reorder-criteria') {
      let ids: unknown;
      try {
        ids = JSON.parse((formData.get('ids') as string) ?? '');
      } catch {
        return Response.json({ error: 'invalid ids' }, { status: 400 });
      }
      const parsed = RemarkCriteriaReorder.safeParse({ ids });
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await criteriaSvc.reorder(db, parsed.data.ids);
      return { ok: true };
    }

    if (intent === 'create-level') {
      const parsed = GradeLevelInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await levelsSvc.create(db, parsed.data);
      return { ok: true };
    }

    if (intent === 'update-level') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      const parsed = parsePatch(GradeLevelInput, raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await levelsSvc.update(db, id, parsed.data);
      return { ok: true };
    }

    if (intent === 'delete-level') {
      if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
      await levelsSvc.remove(db, id);
      return { ok: true };
    }

    if (intent === 'reorder-levels') {
      let ids: unknown;
      try {
        ids = JSON.parse((formData.get('ids') as string) ?? '');
      } catch {
        return Response.json({ error: 'invalid ids' }, { status: 400 });
      }
      const parsed = GradeLevelReorder.safeParse({ ids });
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      await levelsSvc.reorder(db, parsed.data.ids);
      return { ok: true };
    }

    if (intent === 'tuition-settings') {
      let billableStatuses: unknown;
      try {
        billableStatuses = JSON.parse((formData.get('billableStatuses') as string) ?? '');
      } catch {
        return Response.json({ error: 'invalid billableStatuses' }, { status: 400 });
      }
      const parsed = TuitionSettingsInput.safeParse({ billableStatuses });
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      const tuitionSettings = await tuitionSvc.setTuitionSettings(db, parsed.data);
      return { ok: true, tuitionSettings };
    }

    if (intent === 'ranking-weights') {
      const parsed = RankingWeightsInput.safeParse(raw);
      if (!parsed.success) {
        return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
      }
      const rankingWeights = await rankingsSvc.setRankingWeights(db, parsed.data);
      return { ok: true, rankingWeights };
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

export const action = withLiveAction('config', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('config');
  }
}

export default function Config() {
  return <SystemConfigScreen />;
}
