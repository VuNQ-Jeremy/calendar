import type { ActionFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../load-context';
import { getUser } from '../../server/services/auth';
import { TrackBeaconInput } from '../../shared/schemas';
import { auditALS, record } from '../../server/services/audit';

/**
 * Page-view beacon. Resource route (action only, no default export — see routes.ts:36-37's
 * banner) and deliberately NOT under `/api/`: that prefix is Bearer-only (every caller there is a
 * mobile client), and every caller here is a browser tab with a session cookie and no header —
 * see routes.ts's note on zalo-send-card for the same split.
 *
 * Always 204, whatever happens — a beacon endpoint that ever errors teaches the client to
 * retry-loop, and a dropped view is a gap in a chart, not a fact anyone is relying on.
 */
/** A fresh instance every call — a single shared Response cannot safely serve concurrent requests. */
function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** Drop (not reject) an event whose clock is more than a day off in either direction. */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.get(cloudflareCtx).env;

  // Anon hits (a stale tab whose session just expired) are dropped silently — beacon rows without
  // an actor add nothing a real login/logout row didn't already say.
  const user = await getUser(request, env);
  if (!user) return noContent();

  let raw: unknown;
  try {
    const formData = await request.formData();
    raw = JSON.parse((formData.get('payload') as string) ?? '{}');
  } catch {
    return noContent();
  }

  const parsed = TrackBeaconInput.safeParse(raw);
  if (!parsed.success) return noContent();

  const store = auditALS.getStore();
  if (!store) return noContent();
  // newRequestStore defaults source to 'web' for any non-/api/ path — 'beacon' is the honest one.
  store.source = 'beacon';

  const now = Date.now();
  for (const event of parsed.data.events) {
    const withinClockSkew =
      event.at && Math.abs(new Date(event.at).getTime() - now) <= CLOCK_SKEW_MS;
    record({
      action: 'view',
      route: event.path,
      occurredAt: withinClockSkew ? event.at : undefined, // falls back to server time in flush()
      meta: { screen: event.screen ?? null, appVersion: parsed.data.appVersion ?? null },
    });
  }

  return noContent();
}

// No default export: a resource route, same reasoning as every other one in app/routes/.
