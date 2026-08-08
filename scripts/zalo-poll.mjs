#!/usr/bin/env node
/**
 * Watch the Zalo bot's inbox, and optionally replay it into a local webhook.
 *
 *   node scripts/zalo-poll.mjs                      # print what arrives
 *   node scripts/zalo-poll.mjs --forward            # ...and POST it to localhost:5173
 *   node scripts/zalo-poll.mjs --forward=https://…  # ...to somewhere else
 *
 * Token from `ZALO_BOT_TOKEN` in the environment or in `.dev.vars`; webhook secret likewise from
 * `ZALO_WEBHOOK_SECRET` when forwarding.
 *
 * **Why this exists.** Zalo's `getUpdates` has NO `offset` parameter: it is a live long-poll, not
 * a queue with a cursor. Anything sent while no poll is open is gone for good, which makes
 * "message the bot and see what happens" surprisingly hard to do by hand — you have to be
 * listening at the moment the message is sent. This just stays listening.
 *
 * It is also the only practical way to develop the webhook against a local dev server, since Zalo
 * cannot reach localhost.
 *
 * **Two things to know before running it.** Polling and webhooks are mutually exclusive on one
 * bot, so this calls `deleteWebhook` first and therefore DISABLES delivery to whatever URL is
 * currently registered. Use a second, development bot rather than production's — and if you do
 * point it at production's bot, re-register afterwards with
 * `POST /api/zalo/admin?op=set-webhook`.
 *
 * Useful for finding a group's chat_id: add the bot to the group, run this, then @mention the bot
 * there. Bots do not receive plain group messages — only ones that mention them.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://bot-api.zaloplatforms.com';

/** `.dev.vars` is dotenv-shaped and gitignored — the same file wrangler reads locally. */
function devVars() {
  const path = join(root, '.dev.vars');
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const eq = line.indexOf('=');
        return [
          line.slice(0, eq).trim(),
          line
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, ''),
        ];
      })
      .filter(([k]) => k),
  );
}

const vars = devVars();
const TOKEN = process.env.ZALO_BOT_TOKEN || vars.ZALO_BOT_TOKEN;
const SECRET = process.env.ZALO_WEBHOOK_SECRET || vars.ZALO_WEBHOOK_SECRET;

if (!TOKEN) {
  console.error('No ZALO_BOT_TOKEN — set it in the environment or in .dev.vars.');
  process.exit(1);
}

const forwardArg = process.argv.find((a) => a.startsWith('--forward'));
const FORWARD = forwardArg
  ? (forwardArg.split('=')[1] ?? 'http://localhost:5173') + '/api/zalo/webhook'
  : null;

async function call(method, payload) {
  const res = await fetch(`${API}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  return res.json().catch(() => null);
}

const me = await call('getMe');
if (!me?.ok) {
  console.error('getMe failed:', me?.description ?? 'no response');
  process.exit(1);
}
console.log(`Bot: ${me.result.display_name ?? me.result.account_name} (${me.result.id})`);
console.log(`Groups allowed: ${me.result.can_join_groups}`);

// Long-polling and webhooks cannot both be active. See the header note.
await call('deleteWebhook', {});
console.log('Webhook deleted — polling is live. Ctrl-C to stop.\n');
if (FORWARD) console.log(`Forwarding to ${FORWARD}\n`);

for (;;) {
  const update = await call('getUpdates', { timeout: 25 });
  // 408 is the normal "nothing arrived in 25 seconds" answer, not a failure.
  if (!update?.ok) {
    if (update?.error_code !== 408) console.error('  !', update?.description ?? 'no response');
    continue;
  }

  const msg = update.result?.message ?? {};
  const chat = msg.chat ?? {};
  const who = msg.from?.display_name ?? 'unknown';
  console.log(
    `[${chat.chat_type ?? '?'}] ${who}: ${msg.text ?? `(${update.result?.event_name})`}\n` +
      `  chat_id: ${chat.id}`,
  );

  if (!FORWARD) continue;
  try {
    const res = await fetch(FORWARD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': SECRET ?? '' },
      body: JSON.stringify(update),
    });
    console.log(`  → webhook ${res.status}`);
  } catch (err) {
    console.error('  → webhook unreachable:', String(err));
  }
}
