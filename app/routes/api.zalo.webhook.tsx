import { fail, withPublic } from '../../server/api/handler';
import * as zalo from '../../server/services/zalo';
import { auditALS, flush, newSystemStore } from '../../server/services/audit';

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
 *
 * **The one write path with no school in hand**, which is why it is a `withPublic` and takes
 * `rawDb`. Nothing in a delivery names a school: the selectors are Zalo's `chat_id` and a typed
 * pairing code, both globally unique for exactly that reason. `zalo.handleUpdate` resolves the
 * school from whichever row it matches and scopes everything downstream of that point — the
 * fence is inside the service, not here, because here there is nothing yet to fence on.
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

export const action = withPublic(async ({ request, rawDb, env, ctx }) => {
  // Trimmed for the same reason as the bot token: `wrangler secret put` fed from a pipe stores
  // the trailing newline, and Zalo echoes back exactly the secret `setWebhook` was given — clean.
  // Comparing against the trimmed value is strictly more forgiving, never less.
  const expected = env.ZALO_WEBHOOK_SECRET?.trim();
  if (!expected) throw fail('zalo_webhook_unconfigured', 503);

  const got = request.headers.get(HEADER) ?? '';
  if (!secretMatches(got, expected)) {
    console.error('[zalo] webhook rejected', { hasHeader: Boolean(got) });
    throw fail('unauthorized', 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    // Not JSON. Nothing to retry into existence, so accept and drop it.
    return { ok: true };
  }

  const update = zalo.unwrapUpdate(payload);
  if (!update) {
    // Shape we do not recognise. Logged rather than ignored, because the last time this happened
    // it was silent for a day — see unwrap().
    console.error('[zalo] webhook payload not understood', { keys: Object.keys(payload ?? {}) });
    return { ok: true };
  }

  // A fresh 'zalo' system store, nested inside the request-level one workers/app.ts already
  // opened — attributing this to the chat rather than to the generic anon/api caller the outer
  // store would otherwise show, since Zalo's webhook has no session of its own.
  const chatId = update.message?.chat?.id ?? 'unknown';
  const zaloStore = newSystemStore('zalo', chatId);
  try {
    // `handleUpdate` calls `setActorTenant` as soon as a row tells it which school this chat
    // belongs to, so the audit rows below are stamped with that school rather than the default.
    await auditALS.run(zaloStore, () => zalo.handleUpdate(rawDb, env, update));
  } catch (err) {
    console.error('[zalo] webhook handler threw', { err: String(err) });
  } finally {
    if (zaloStore.entries.length) ctx.waitUntil(flush(rawDb, zaloStore));
  }
  return { ok: true };
});
