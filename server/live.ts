import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../app/load-context';
import type { MutationDomain } from '../shared/live';

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
 * multipart upload to read one field would be wasteful.
 */
export function withLiveAction<T>(spec: DomainSpec, action: ActionFn<T>): ActionFn<T> {
  return async (args) => {
    const clone = typeof spec === 'function' ? args.request.clone() : null;
    const result = await action(args);
    if (result instanceof Response && result.status >= 400) return result;

    let domains: readonly MutationDomain[];
    if (typeof spec === 'function') {
      let intent: string | null = null;
      try {
        intent = ((await clone!.formData()).get('intent') as string | null) ?? null;
      } catch {
        // Not a form submission — leave intent null and let the spec decide.
      }
      const resolved = spec(intent);
      if (!resolved) return result;
      domains = typeof resolved === 'string' ? [resolved] : resolved;
    } else {
      domains = [spec];
    }

    const { env, ctx } = args.context.get(cloudflareCtx);
    for (const domain of domains) notifyLive(env, ctx, domain);
    return result;
  };
}
