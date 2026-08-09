import { DurableObject } from 'cloudflare:workers';
import { createDb } from '../server/db/index';
import * as zalo from '../server/services/zalo';

/**
 * Durable Object that pulls Zalo messages instead of waiting to be pushed them.
 *
 * **Why this exists.** Zalo's webhook is unusable on a `*.workers.dev` host. Its delivery agent
 * identifies as `User-Agent: Java/1.8.0_192`, and Cloudflare's browser-integrity check rejects
 * that exact signature at the edge with error 1010 — a 403 the Worker never sees. Nothing about
 * it is configurable on workers.dev, and the failure is silent from both ends: Zalo records a
 * delivery attempt, the Worker logs nothing at all, and a paired parent simply never gets a
 * reply. Verified by replaying Zalo's exact headers: `Java/1.8.0_192` → 403, any other
 * user-agent → 200.
 *
 * Long-polling has no such problem, because the connection is outbound. `getUpdates` holds a
 * request open for up to ~25s and answers with an update or a 408, so a chain of them is a
 * continuous receiver. That needs something long-lived, which a stateless Worker is not — hence a
 * Durable Object driving itself with alarms.
 *
 * **This is the fallback, not the destination.** Once the app lives on a real domain, a
 * Configuration Rule can disable the integrity check for `/api/zalo/webhook` and the webhook
 * becomes the better mechanism: no idle polling, no single-consumer constraint. `stop()` and
 * `setWebhook` are all it takes to switch over.
 *
 * **Exactly one poller may run.** `getUpdates` is a single-consumer queue — two pollers would
 * split the messages between them and each would act on half. Callers therefore always address
 * this DO by the fixed name in POLLER_NAME below, so there is only ever one instance.
 */

/** The one and only poller id. Anything else would double-consume the update stream. */
export const POLLER_NAME = 'zalo-poller-singleton';

/**
 * How long each `getUpdates` call may block. Kept under 30s: a Durable Object alarm that runs
 * too long risks eviction mid-flight, and a shorter poll simply re-arms sooner.
 */
const POLL_SECONDS = 25;

/** Marks the poller as wanted. Survives eviction, so a restarted DO knows to resume. */
const RUNNING_KEY = 'running';
const STATS_KEY = 'stats';

type Stats = {
  startedAt: string;
  lastPollAt: string | null;
  lastMessageAt: string | null;
  polls: number;
  messages: number;
  errors: number;
};

const ZERO: Stats = {
  startedAt: '',
  lastPollAt: null,
  lastMessageAt: null,
  polls: 0,
  messages: 0,
  errors: 0,
};

export class ZaloPoller extends DurableObject<Env> {
  /**
   *   POST /start   begin (or resume) polling — idempotent
   *   POST /stop    stop after the in-flight poll returns
   *   GET  /status  what it has seen
   */
  async fetch(request: Request): Promise<Response> {
    const op = new URL(request.url).pathname;

    if (op === '/start') {
      if (!zalo.isEnabled(this.env)) {
        return Response.json({ error: 'zalo_disabled' }, { status: 503 });
      }
      const already = await this.ctx.storage.get<boolean>(RUNNING_KEY);
      await this.ctx.storage.put(RUNNING_KEY, true);
      if (!already) {
        await this.ctx.storage.put<Stats>(STATS_KEY, {
          ...ZERO,
          startedAt: new Date().toISOString(),
        });
      }
      // Arming an alarm that is already armed is a no-op, which is what makes /start idempotent
      // and lets the cron re-arm a poller whose chain has broken without ever doubling it up.
      await this.ctx.storage.setAlarm(Date.now());
      return Response.json({ ok: true, resumed: Boolean(already) });
    }

    if (op === '/stop') {
      await this.ctx.storage.put(RUNNING_KEY, false);
      await this.ctx.storage.deleteAlarm();
      return Response.json({ ok: true });
    }

    const stats = (await this.ctx.storage.get<Stats>(STATS_KEY)) ?? ZERO;
    const running = Boolean(await this.ctx.storage.get<boolean>(RUNNING_KEY));
    return Response.json({ running, ...stats, nextAlarm: await this.ctx.storage.getAlarm() });
  }

  /**
   * One poll, then re-arm.
   *
   * The re-arm is in a `finally` so the chain cannot die on an unexpected throw — a poller that
   * stops silently is the same invisible failure this class exists to replace. The cron in
   * workers/app.ts re-arms it anyway every 15 minutes as a second line of defence.
   */
  async alarm(): Promise<void> {
    if (!(await this.ctx.storage.get<boolean>(RUNNING_KEY))) return;

    const stats = (await this.ctx.storage.get<Stats>(STATS_KEY)) ?? {
      ...ZERO,
      startedAt: new Date().toISOString(),
    };
    stats.polls++;
    stats.lastPollAt = new Date().toISOString();
    let gotMessage = false;

    try {
      const res = await zalo.callBot(this.env, 'getUpdates', { timeout: POLL_SECONDS });
      // 408 is the documented "nothing arrived" answer, not a failure. Anything else that is not
      // ok is worth counting, but never worth breaking the chain over.
      if (res.ok && res.result) {
        const update = zalo.unwrapUpdate(res);
        if (update?.message) {
          gotMessage = true;
          stats.messages++;
          stats.lastMessageAt = new Date().toISOString();
          await zalo.handleUpdate(createDb(this.env), this.env, update);
        }
      } else if (res.error_code && res.error_code !== 408) {
        stats.errors++;
      }
    } catch (err) {
      stats.errors++;
      console.error('[zalo-poll] alarm failed', { err: String(err) });
    } finally {
      await this.ctx.storage.put<Stats>(STATS_KEY, stats);
      if (await this.ctx.storage.get<boolean>(RUNNING_KEY)) {
        // Straight back in. `getUpdates` hands over one update per call, so after a message there
        // may be more already waiting — the gap between polls is the only window in which
        // anything can be missed, and it should be as close to nothing as possible.
        await this.ctx.storage.setAlarm(Date.now() + (gotMessage ? 0 : 100));
      }
    }
  }
}

/** The singleton stub. Every caller must go through this, never `idFromName` directly. */
export function pollerStub(env: Env): DurableObjectStub {
  return env.ZALO_POLLER.get(env.ZALO_POLLER.idFromName(POLLER_NAME));
}
