import { fail, withAuth } from '../../server/api/handler';
import * as zalo from '../../server/services/zalo';
import { pollerStub } from '../../workers/zalo-poller';

/**
 * Bot plumbing: register the webhook, and see what Zalo thinks is going on. **Admin only.**
 *
 *   GET  /api/zalo/admin?op=me            — validate the token, show the bot account
 *   GET  /api/zalo/admin?op=webhook-info  — what URL Zalo currently delivers to
 *   POST /api/zalo/admin?op=set-webhook   — point Zalo at THIS deployment
 *   POST /api/zalo/admin?op=delete-webhook
 *
 * `set-webhook` derives its URL from the incoming request's own origin. That is the point of
 * doing this as a route rather than a script: production and calendar-test each register
 * themselves by being called, and there is no constant to get wrong or forget to update. It also
 * keeps the bot token where it already lives — in the Worker's env — instead of copying it onto
 * a developer's machine.
 *
 * Note that Zalo treats webhook and long-polling as mutually exclusive: registering a webhook
 * stops `getUpdates` from returning anything, and `delete-webhook` is how local development gets
 * it back. That is also why prod and dev should be two different bots.
 */
export const loader = withAuth('admin', async ({ request, env }) => {
  const op = new URL(request.url).searchParams.get('op');
  if (!zalo.isEnabled(env)) throw fail('zalo_disabled', 503);
  if (op === 'me') return zalo.callBot(env, 'getMe', {});
  if (op === 'webhook-info') return zalo.callBot(env, 'getWebhookInfo', {});
  if (op === 'poll-status') {
    const res = await pollerStub(env).fetch('https://zalo-poller/status');
    return res.json();
  }
  throw fail('bad_op', 400);
});

export const action = withAuth('admin', async ({ request, env }) => {
  const op = new URL(request.url).searchParams.get('op');
  if (!zalo.isEnabled(env)) throw fail('zalo_disabled', 503);

  if (op === 'set-webhook') {
    if (!env.ZALO_WEBHOOK_SECRET) throw fail('missing_webhook_secret', 503);
    const url = new URL('/api/zalo/webhook', new URL(request.url).origin).toString();
    const res = await zalo.callBot(env, 'setWebhook', {
      url,
      secret_token: env.ZALO_WEBHOOK_SECRET,
    });
    return { url, res };
  }

  if (op === 'delete-webhook') return zalo.callBot(env, 'deleteWebhook', {});

  // The poller and the webhook are alternatives, never both: `getUpdates` returns nothing while
  // a webhook is registered. Starting the poller therefore clears the webhook, and stopping it
  // leaves the choice of what to register next to the caller.
  if (op === 'poll-start') {
    await zalo.callBot(env, 'deleteWebhook', {});
    const res = await pollerStub(env).fetch('https://zalo-poller/start', { method: 'POST' });
    return res.json();
  }

  if (op === 'poll-stop') {
    const res = await pollerStub(env).fetch('https://zalo-poller/stop', { method: 'POST' });
    return res.json();
  }

  throw fail('bad_op', 400);
});
