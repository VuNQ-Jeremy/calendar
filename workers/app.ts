/// <reference types="vite/client" />
import { createRequestHandler, RouterContextProvider } from 'react-router';
import { cloudflareCtx } from '../app/load-context';

// Durable Object used to relocate Anthropic API egress to a supported region
// (see workers/translate-proxy.ts). Must be exported from the Worker's main
// module for Cloudflare to register the class.
export { TranslateProxy } from './translate-proxy';

// Durable Object that fans live cache-invalidation messages out to every open
// browser tab (see workers/live-hub.ts). Same registration requirement.
export { LiveHub } from './live-hub';

// Durable Object that long-polls Zalo for incoming messages, because Cloudflare's edge rejects
// Zalo's webhook agent on *.workers.dev (see workers/zalo-poller.ts). Same registration
// requirement as the two above.
export { ZaloPoller } from './zalo-poller';

// Durable Object backing the auth rate limiter, one instance per key
// (see workers/rate-limiter.ts). Same registration requirement.
export { RateLimiter } from './rate-limiter';

import { handleLiveUpgrade } from './live-hub';
import { secure } from './security-headers';
import { pollerStub } from './zalo-poller';
import { runScheduled } from '../server/services/notify';
import { isEnabled as zaloEnabled } from '../server/services/zalo';
import { createRawDb } from '../server/db/internal';
import {
  auditALS,
  flush,
  newRequestStore,
  newSystemStore,
  purgeExpiredSessions,
  purgeOldLogs,
} from '../server/services/audit';

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handled before the React Router handler on purpose: the 101 response
    // carries a live WebSocket and must reach the runtime unmodified.
    if (url.pathname === '/ws') {
      try {
        return await handleLiveUpgrade(request, env);
      } catch (err) {
        console.error('[ws] upgrade failed', {
          name: err instanceof Error ? err.name : typeof err,
          message: err instanceof Error ? err.message : String(err),
        });
        return new Response('upgrade failed', { status: 500 });
      }
    }

    const context = new RouterContextProvider(new Map([[cloudflareCtx, { env, ctx }]]));
    const start = Date.now();
    // Ambient collector for the activity log (see server/services/audit.ts). Every mutation,
    // page-view beacon and auth event pushes into `store.entries` during `requestHandler`; once it
    // resolves the buffer is fixed, so flushing right after is safe even though the response body
    // may still be streaming — the flush itself rides `ctx.waitUntil`, off the response path.
    const store = newRequestStore(request);
    try {
      const response = await auditALS.run(store, () => requestHandler(request, context));
      store.status ??= response.status;
      if (store.entries.length) ctx.waitUntil(flush(createRawDb(env), store));
      console.log('[request]', {
        method: request.method,
        path: url.pathname,
        status: response.status,
        ms: Date.now() - start,
      });
      return secure(response);
    } catch (err) {
      // Whatever ran before the throw may already have pushed entries (e.g. a login_failed
      // record right before an unrelated downstream error) — flush them rather than drop them.
      if (store.entries.length) {
        store.status ??= 500;
        ctx.waitUntil(flush(createRawDb(env), store));
      }
      console.error('[request] unhandled', {
        method: request.method,
        path: url.pathname,
        ms: Date.now() - start,
        name: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  /**
   * Cron Triggers (see `triggers.crons` in wrangler.jsonc).
   *
   *   `*​/15 * * * *`  — class-starting-soon sweep
   *   `0 1 * * *`     — 01:00 UTC = 08:00 Vietnam (ICT, UTC+7), the daily digest
   *   `0 12 * * *`    — 12:00 UTC = 19:00 ICT, tomorrow's session previews
   *
   * `waitUntil` rather than a bare await so a slow Expo response cannot make the invocation
   * itself look like a timeout; the work still runs to completion.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Re-arm the Zalo poller on every tick. `/start` is idempotent — an already-running poller
    // just keeps going — so this costs nothing and means a chain broken by an eviction, a deploy
    // or an unexpected throw self-heals within fifteen minutes instead of staying dead until
    // somebody notices that pairing stopped working.
    if (zaloEnabled(env)) {
      ctx.waitUntil(
        pollerStub(env)
          .fetch('https://zalo-poller/start', { method: 'POST' })
          .then(() => undefined)
          .catch((err) => console.error('[zalo-poll] re-arm failed', { err: String(err) })),
      );
    }

    // System-actor store for the activity log — mirrors the request-scoped one in fetch(), but
    // there is no Request here at all, which is exactly the case ALS exists for (see audit.ts).
    const cronStore = newSystemStore('cron', event.cron);
    ctx.waitUntil(
      auditALS
        .run(cronStore, () => runScheduled(event.cron, env, new Date(event.scheduledTime)))
        .catch((err) => {
          // A throwing cron is retried by Cloudflare, which for a notification job means
          // duplicates. The ledger makes that safe, but logging and swallowing is still the
          // honest behaviour: there is no user waiting on this.
          console.error('[cron] failed', { cron: event.cron, err: String(err) });
        })
        .finally(() => {
          if (cronStore.entries.length) return flush(createRawDb(env), cronStore);
        }),
    );

    // Retention purge, on the same daily tick as the digest + garden sweep. Bounded and
    // self-healing (see purgeOldLogs) so a missed day never needs a manual catch-up.
    if (event.cron === '0 1 * * *') {
      ctx.waitUntil(
        purgeOldLogs(createRawDb(env), new Date()).catch((err) =>
          console.error('[audit] purge failed', { err: String(err) }),
        ),
      );
      ctx.waitUntil(
        purgeExpiredSessions(createRawDb(env), new Date()).catch((err) =>
          console.error('[audit] session purge failed', { err: String(err) }),
        ),
      );
    }
  },
} satisfies ExportedHandler<Env>;
