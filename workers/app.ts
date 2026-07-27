/// <reference types="vite/client" />
import { createRequestHandler, RouterContextProvider } from 'react-router';
import { cloudflareCtx } from '../app/load-context';

// Durable Object used to relocate Anthropic API egress to a supported region
// (see workers/translate-proxy.ts). Must be exported from the Worker's main
// module for Cloudflare to register the class.
export { TranslateProxy } from './translate-proxy';

import { runScheduled } from '../server/services/notify';

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const context = new RouterContextProvider(new Map([[cloudflareCtx, { env, ctx }]]));
    const url = new URL(request.url);
    const start = Date.now();
    try {
      const response = await requestHandler(request, context);
      console.log('[request]', {
        method: request.method,
        path: url.pathname,
        status: response.status,
        ms: Date.now() - start,
      });
      return response;
    } catch (err) {
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
   *
   * `waitUntil` rather than a bare await so a slow Expo response cannot make the invocation
   * itself look like a timeout; the work still runs to completion.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScheduled(event.cron, env, new Date(event.scheduledTime)).catch((err) => {
        // A throwing cron is retried by Cloudflare, which for a notification job means
        // duplicates. The ledger makes that safe, but logging and swallowing is still the
        // honest behaviour: there is no user waiting on this.
        console.error('[cron] failed', { cron: event.cron, err: String(err) });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
