import { fail, withPublic } from '../../server/api/handler';
import * as zalo from '../../server/services/zalo';

/**
 * Zalo Bot webhook — every message anyone sends the bot arrives here.
 *
 * **Unauthenticated by necessity, secret-gated in practice.** Zalo's servers have no session and
 * no bearer token; what they do carry is the `X-Bot-Api-Secret-Token` header, echoing whatever
 * secret was registered with `setWebhook`. That header is the entire authentication story, so it
 * is compared in constant time and an unset secret rejects everything rather than defaulting
 * open — an endpoint that links arbitrary chat ids to arbitrary people is not one to leave
 * unguarded while somebody remembers to configure it.
 *
 * **Always 200 on a verified update, whatever happens next.** A non-2xx here earns a retry, and a
 * malformed message that fails forever would be retried forever. `handleUpdate` swallows its own
 * errors for the same reason; this catch is the backstop.
 */
const HEADER = 'X-Bot-Api-Secret-Token';

/** Constant-time string compare — same shape as the one in server/services/crypto.ts. */
function secretMatches(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const action = withPublic(async ({ request, db, env }) => {
  const expected = env.ZALO_WEBHOOK_SECRET;
  if (!expected) throw fail('zalo_webhook_unconfigured', 503);

  const got = request.headers.get(HEADER) ?? '';
  if (!secretMatches(got, expected)) {
    console.error('[zalo] webhook rejected', { hasHeader: Boolean(got) });
    throw fail('unauthorized', 401);
  }

  let payload: { result?: zalo.ZaloUpdate } | null = null;
  try {
    payload = (await request.json()) as { result?: zalo.ZaloUpdate };
  } catch {
    // Not JSON. Nothing to retry into existence, so accept and drop it.
    return { ok: true };
  }

  try {
    // The bot API wraps everything in `{ ok, result }`; long-polled updates from getUpdates have
    // the identical shape, which is what lets scripts/zalo-poll.mjs replay them at this route.
    if (payload?.result) await zalo.handleUpdate(db, env, payload.result);
  } catch (err) {
    console.error('[zalo] webhook handler threw', { err: String(err) });
  }
  return { ok: true };
});
