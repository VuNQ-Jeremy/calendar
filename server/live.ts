import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../app/load-context';
import type { MutationDomain } from '../shared/live';
import { hasCrudEntry, noteAction, record } from './services/audit';

/**
 * Server side of the live-update feature: tell every connected browser tab
 * that a domain changed, so it can refresh what it is showing.
 *
 * The mutation itself must never depend on this. The broadcast rides
 * ctx.waitUntil and swallows its own errors — a hub that is down slows nothing
 * and fails nothing; clients just fall back to refreshing on navigation.
 */
export function notifyLive(env: Env, ctx: ExecutionContext, domain: MutationDomain): void {
  try {
    const stub = env.LIVE_HUB.get(env.LIVE_HUB.idFromName('global'));
    ctx.waitUntil(
      stub
        .fetch('https://live-hub.internal/broadcast', {
          method: 'POST',
          body: JSON.stringify({ domain }),
        })
        .catch((err: unknown) => {
          console.error('[live] broadcast failed', { domain, err: String(err) });
        }),
    );
  } catch (err) {
    console.error('[live] broadcast failed', { domain, err: String(err) });
  }
}

type ActionFn<T> = (args: ActionFunctionArgs) => Promise<T>;

/**
 * Either a fixed domain, or a function of the submitted `intent` returning one
 * domain, several, or null to skip the broadcast for that intent.
 */
type DomainSpec =
  MutationDomain | ((intent: string | null) => MutationDomain | readonly MutationDomain[] | null);

/**
 * Wrap a route action so a successful mutation notifies other tabs. The domain
 * mirrors the `invalidateAfterMutation(...)` call in the same route's
 * clientAction — that one covers the tab that made the change, this one covers
 * everybody else.
 *
 * What counts as success:
 *   - a 4xx/5xx Response (the validation-failure path in these actions) does
 *     not broadcast;
 *   - a thrown redirect (requireStaff bouncing a student) never reaches here;
 *   - a *returned* redirect is a completed mutation, so it does broadcast.
 *
 * A function spec needs the form body, which the action itself consumes, so the
 * request is cloned first — only for those routes, since cloning a 20 MB
 * multipart upload to read one field would be wasteful. Fixed-spec routes get
 * the same clone too (unless they're multipart, same concern) purely so the
 * activity log's coarse fallback below has an `intent` to attach to the row —
 * the live-broadcast side of this function never needed it.
 *
 * Activity-log side (server/services/audit.ts): every successful action gets its
 * `intent`/`domain`/`status` noted on the ambient store, and — only when the action
 * did NOT already push a precise `create`/`update`/`delete` entry itself (a service
 * instrumented in Stage 2's priority list) — a coarse `mutation` row, so no write path
 * is ever completely invisible even before every service gets precise instrumentation.
 */
export function withLiveAction<T>(spec: DomainSpec, action: ActionFn<T>): ActionFn<T> {
  return async (args) => {
    const isMultipart = (args.request.headers.get('content-type') ?? '').startsWith(
      'multipart/form-data',
    );
    const clone = typeof spec === 'function' || !isMultipart ? args.request.clone() : null;
    const result = await action(args);
    const status = result instanceof Response ? result.status : 200;

    let intent: string | null = null;
    if (clone) {
      try {
        intent = ((await clone.formData()).get('intent') as string | null) ?? null;
      } catch {
        // Not a form submission (e.g. a JSON action) — leave intent null.
      }
    }

    if (result instanceof Response && result.status >= 400) {
      noteAction(intent, null, status);
      return result;
    }

    let domains: readonly MutationDomain[] | null;
    if (typeof spec === 'function') {
      const resolved = spec(intent);
      domains = resolved ? (typeof resolved === 'string' ? [resolved] : resolved) : null;
    } else {
      domains = [spec];
    }

    noteAction(intent, domains ? domains.join(',') : null, status);
    // domains === null means the spec itself judged this intent a non-mutation (e.g. a
    // dry-run/check action) — the same judgment call this function already makes for the
    // live-broadcast, reused here so a check action doesn't get logged as a mutation either.
    if (domains && !hasCrudEntry()) record({ action: 'mutation' });

    if (domains) {
      const { env, ctx } = args.context.get(cloudflareCtx);
      for (const domain of domains) notifyLive(env, ctx, domain);
    }
    return result;
  };
}
