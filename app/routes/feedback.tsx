import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  ClientActionFunctionArgs,
} from 'react-router';
import { useOutletContext } from 'react-router';
import { FeedbackScreen } from '../../src/feedback.jsx';
import type { AppContext } from './_app.js';
import { tenantDbFor } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin, requireStaff } from '../../server/services/auth';
import * as feedbackSvc from '../../server/services/feedback';
import * as changelogSvc from '../../server/services/changelog';
import { notifyFeedbackIssue } from '../../server/services/github';
import { FeedbackInput, parsePatch } from '../../shared/schemas';
import { K, swrLoad, invalidateAfterMutation } from '../../src/lib/route-cache.js';
import { withLiveAction } from '../../server/live';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);
  const [feedback, hiddenChangelog] = await Promise.all([
    feedbackSvc.list(db),
    changelogSvc.getHiddenVersions(db),
  ]);
  return { feedback, hiddenChangelog };
}

export async function clientLoader({ serverLoader }: ClientLoaderFunctionArgs) {
  return swrLoad(K.feedback, () => serverLoader() as Promise<Awaited<ReturnType<typeof loader>>>);
}
clientLoader.hydrate = true as const;

async function actionImpl({ request, context }: ActionFunctionArgs) {
  const { env, ctx } = context.get(cloudflareCtx);
  const staff = await requireStaff(request, env);
  const db = tenantDbFor(env, staff);
  const formData = await request.formData();
  const intent = formData.get('intent') as string;
  const id = formData.get('id') as string | null;

  if (intent === 'delete') {
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 });
    await feedbackSvc.remove(db, id);
    return { ok: true };
  }

  // Hiding a release note is not feedback CRUD: it edits what the whole school reads on this
  // page, so it takes Admin where the rest of this action takes staff. The version is checked
  // against the changelog's own heading format rather than trusted — the value goes into a
  // stored list that every later render filters on.
  if (intent === 'changelog-hide' || intent === 'changelog-show') {
    await requireAdmin(request, env);
    const version = formData.get('version');
    if (typeof version !== 'string' || !/^v\d+\.\d+$/.test(version)) {
      return Response.json({ error: 'bad version' }, { status: 400 });
    }
    await changelogSvc.setVersionHidden(db, version, intent === 'changelog-hide');
    return { ok: true };
  }

  const raw = Object.fromEntries(formData);

  if (intent === 'create') {
    const parsed = FeedbackInput.safeParse(raw);
    if (!parsed.success) return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
    const row = await feedbackSvc.create(db, parsed.data);
    notifyFeedbackIssue(env, ctx, db, row);
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

export const action = withLiveAction('feedback', actionImpl);

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateAfterMutation('feedback');
  }
}

export default function Feedback() {
  const { user } = useOutletContext<AppContext>();
  return <FeedbackScreen user={user} />;
}
