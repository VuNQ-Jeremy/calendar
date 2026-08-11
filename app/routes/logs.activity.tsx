import type { LoaderFunctionArgs } from 'react-router';
import { ActivityScreen } from '../../src/screens-activity.jsx';
import { createDb } from '../../server/db/index';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';
import * as auditViews from '../../server/services/audit-views';

/**
 * /logs → Activity: the append-only mutation/view/auth log (server/services/audit.ts writes it,
 * server/services/audit-views.ts reads it).
 *
 * `requireAdmin` — same reasoning as the schedule and notifications tabs beside it, doubled: this
 * is not just a school-wide view, it is EVERY user's every action, so it is the most sensitive
 * page in the app.
 *
 * **No `clientLoader`, unlike every other cached route.** A diagnostics/audit page must show what
 * just happened, not a stale-while-revalidate snapshot from whenever the last load or mutation
 * happened to mark it stale — so this route always hits the server, and `cacheKeyForPath` returns
 * `null` for it (src/lib/route-cache.ts) so the shell's stale-refresh hook never subscribes to a
 * key that would otherwise go stale on every single mutation in the app.
 *
 * **No `action` — read-only by design**, same stance as `/logs` itself (see that route's comment).
 * No revert, no restore: this is a record of what happened, not a place to undo it.
 */

function numOrUndef(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export type ActivityView = 'stream' | 'sessions' | 'entity' | 'security';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  const db = createDb(env);
  const url = new URL(request.url);
  const viewParam = url.searchParams.get('view');
  const view: ActivityView =
    viewParam === 'sessions' || viewParam === 'entity' || viewParam === 'security'
      ? viewParam
      : 'stream';

  const accounts = await auditViews.listAccountsForFilter(db);

  if (view === 'security') {
    const security = await auditViews.securityOverview(db, new Date());
    return { view, accounts, security } as const;
  }

  if (view === 'sessions') {
    const accountId = url.searchParams.get('accountId') ?? '';
    const beforeId = numOrUndef(url.searchParams.get('before'));
    const session = accountId
      ? await auditViews.sessionTimeline(db, accountId, beforeId)
      : { rows: [], nextCursor: null };
    return { view, accounts, accountId, session } as const;
  }

  if (view === 'entity') {
    const entityType = url.searchParams.get('entityType') ?? '';
    const entityId = url.searchParams.get('entityId') ?? '';
    const history =
      entityType && entityId ? await auditViews.entityHistory(db, entityType, entityId) : [];
    return { view, accounts, entityType, entityId, history } as const;
  }

  const filter: auditViews.ActivityFilter = {
    actorKind: url.searchParams.get('actorKind') || undefined,
    accountId: url.searchParams.get('accountId') || undefined,
    action: url.searchParams.get('action') || undefined,
    entityType: url.searchParams.get('entityType') || undefined,
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined,
    beforeId: numOrUndef(url.searchParams.get('before')),
    limit: 100,
  };
  const stream = await auditViews.listActivity(db, filter);
  return { view, accounts, filter, stream } as const;
}

export default function LogsActivityRoute() {
  return <ActivityScreen />;
}
