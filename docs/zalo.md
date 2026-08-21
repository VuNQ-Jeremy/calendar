# The Zalo channel

How Mochi talks to parents.

Zalo is what this school actually uses. Before this feature the app only helped indirectly: it
rendered share cards that a teacher copied and pasted into a group chat by hand, one family at a
time. This makes Zalo a real delivery channel next to Expo push.

It exists to reach people push cannot — **parents**. A parent *can* have an account now (and the
parent portal, when an admin switches it on, gives them their children's schedule, attendance,
report and fee slips), but that is opt-in twice over: per school and per family. Every family is
already on Zalo. So Zalo is the channel this feature is built around, not a stopgap until logins
arrive — and the share cards below remain how most parents receive a document.

> Keep this file current when the channel changes. It is the only place the operational details
> and the traps are written down; the code comments explain individual decisions, not the shape.

---

## What it does today

**It is a notifier, not an assistant.** Four commands in, six kinds of message out. It cannot
answer questions or look anything up — every message it sends was triggered by the app or a cron.

### Inbound

| Input | Where | Effect |
|---|---|---|
| a bare 6-character code | private only | pairs that chat |
| `/link` · `/start` · `/ketnoi` + code | anywhere | pairs that chat |
| `/unlink` · `/huy` | anywhere | detaches that chat |
| anything else | private | a short help reply |
| anything else | group | **silence** |

Two rules that look arbitrary and are not:

- **In a group the bot must be @mentioned.** Zalo delivers nothing to a bot otherwise, and it
  leaves the mention in the text (`"@Bot Mochi /link ABC234"`), so commands are matched anywhere
  in a message rather than at its start.
- **In a group only an explicit command counts.** A bare code is ignored there. A class group is
  full of ordinary conversation, and a bot that pipes up because somebody typed six capitals is a
  bot that gets removed from the group.

### Outbound

Automatic, from `server/services/notify.ts`:

| Job | When | Goes to | Ledger key |
|---|---|---|---|
| `runClassReminders` | 30 min before a session | family chats | `zalo-class:{eventId}:{date}` |
| `runEveningPreview` | 19:00 ICT | the class **group** if linked, else each family | `zalo-preview:{eventId}:{date}` |
| `runEveningPreview` (staff) | 19:00 ICT | every staff chat | `zalo-preview-staff:{date}` |

The evening preview goes to the group **instead of** the families, never both — otherwise a parent
who is in the group is told twice.

On a button, from the four share cards:

| Card | Source | Target |
|---|---|---|
| Fee slip | `src/tuition/fee-slip.tsx` | `parent-of:` — **parent records only** |
| Report card | `src/assessments/report-slip.tsx` | `student:` — the family, either route |
| Next session | `src/preview/preview-slip.tsx` | `class:` — the group |
| Class garden | `src/garden/share-card.tsx` | `class:` — the group |

The fee slip is the odd one out on purpose. A student link is *whoever redeemed that student's
code*, which may be the student; fine for a class reminder reaching a teenager, wrong for a bill.
So money resolves through `parents` records only and answers `not_linked` rather than sending.

On request, from `server/services/login-otp.ts` — the bot's **second consumer**, and the reason
`zalo_chats` now matters to login, not just notifications:

| Message | When |
|---|---|
| `Mã đăng nhập Mochi cho <tên>: 123456 (hiệu lực 5 phút). Không chia sẻ mã này.` | one account matched the phone |
| `Mã đăng nhập Mochi: 123456 (hiệu lực 5 phút). Không chia sẻ mã này.` | several accounts share the phone (the name would leak who else is on it) |
| `Mã đặt lại mật khẩu Mochi: ...` | same shapes, for the `purpose: 'set-password'` recovery variant |

Text only, **never a link** — the whole point of phone+code over anything Zalo-native is that the
family never has to tap something inside the chat. Delivery reuses `sendText`, so it inherits the
same no-op-without-`ZALO_BOT_TOKEN` and sequential-send behavior as everything else in this file.
The resolution algorithm that decides which chats receive it — union of the account's own pairing
and its family's — lives in `login-otp.ts` and is documented there and in `docs/security.md`'s
enumeration-safety section; this file only owns the delivery mechanics.

**Self-service pairing.** A signed-in account can request its own code from Profile → "Kết nối
Zalo" (a thin wrapper over `createPairCode(db, { accountId })`, the exact `self` target
`api.zalo.pair.tsx` already supported for staff). This is what lets a parent or student pair
their own chat without a teacher's involvement — the staff-issued codes in the table below are
still there for the cases where the person cannot pair themselves (a class group, someone else's
child).

---

## Pairing

Nothing can link a chat from the app's side alone — Zalo does not reveal who anybody is until they
message the bot. So pairing is always two-sided: staff generate a code, the person sends it.

Three targets, all independent (`/config` → Zalo connections):

| Target | Reaches | Needs |
|---|---|---|
| **Student** (default) | that student's family | nothing — works for every student |
| **Parent** | a `parents` record, possibly covering siblings | an existing parent row |
| **Class group** | the group chat | bot added to the group, then `@Bot /link <code>` |

Student is the default because `parents` rows are typed in by hand and most students have none —
the dropdown used to offer a fraction of the school.

Codes are single-use, expire in 24 hours, and use an alphabet with no `O/0` or `I/1`, because they
are read off a screen and retyped on a phone. A code's kind must match the chat: a personal code
sent in a group is refused, and so is a class code sent privately. Both would be silent privacy
failures.

Re-pairing a chat **moves** it rather than duplicating, so a mistaken pairing cannot leave a row
nobody can see still delivering someone else's notifications.

---

## How it is wired

```
                    ┌── outbound: plain HTTPS from the Worker ──► Zalo Bot API
Worker (calendar) ──┤
                    └── inbound:  ZaloPoller (Durable Object) ──► getUpdates, chained
```

**Outbound** is a plain `fetch` from the Worker, like Expo and unlike Anthropic — Zalo is a
Vietnamese service and has no quarrel with Cloudflare's Hong Kong egress, so it must NOT go
through `TRANSLATE_DO`. Everything funnels through `callBot` so there is one place to reroute if
that ever changes.

**Inbound is polled, not pushed** — see the trap below. `workers/zalo-poller.ts` is a Durable
Object that holds a 25-second `getUpdates`, hands anything it receives to the same `handleUpdate`
the webhook would, and re-arms itself in a `finally` so an unexpected throw cannot end the chain
quietly. `scheduled()` re-arms it every 15 minutes as a second line of defence; `/start` is
idempotent, so that costs nothing and a broken chain self-heals.

**Exactly one poller may run.** `getUpdates` is a single-consumer queue — two would split the
messages and each act on half. Callers always go through `pollerStub()`, which addresses a fixed
name.

### Files

| Path | What |
|---|---|
| `server/services/zalo.ts` | the whole protocol: send, target, pair, dispatch |
| `workers/zalo-poller.ts` | the polling Durable Object |
| `app/routes/api.zalo.webhook.tsx` | webhook receiver (unused today, kept working) |
| `app/routes/api.zalo.pair.tsx` | codes and the link registry |
| `app/routes/api.zalo.admin.tsx` | bot/webhook/poller control |
| `app/routes/zalo-send-card.tsx` | share-card upload and send |
| `app/routes/zalo-media.$key.tsx` | the image, fetched by Zalo itself |
| `migrations/0027_zalo.sql`, `0028_zalo_student.sql` | `zalo_chats`, `zalo_pair_codes` |
| `test-worker/zalo.test.js` | 29 tests |
| `e2e/crud-zalo.spec.ts` | pairing lifecycle through the UI |
| `scripts/zalo-poll.mjs` | local development receiver |

---

## Configuration

Two bots, permanently. They cannot be one: webhook and long-polling are mutually exclusive per
bot, so local tooling would silently steal production's messages.

| Bot | Id | Used by |
|---|---|---|
| **Bot Mochi English** | `966509149039989872` | production (`calendar`) |
| **Bot Mochi dev** | `3654179222852326364` | `.dev.vars` + `calendar-test` |

Secrets, declared in `globals.d.ts` and set with `wrangler secret put`:

- `ZALO_BOT_TOKEN` — absent means every send quietly no-ops
- `ZALO_WEBHOOK_SECRET` — absent means the webhook rejects everything

Each fails safe alone. `calendar-test` deliberately carries the dev bot, and binds `ZALO_POLLER`
without ever starting it — a poller there would eat the updates `scripts/zalo-poll.mjs` needs.

### Operating it

```
GET  /api/zalo/admin?op=me             validate the token
GET  /api/zalo/admin?op=poll-status    polls, messages, errors, next alarm
POST /api/zalo/admin?op=poll-start     clears the webhook, starts polling
POST /api/zalo/admin?op=poll-stop
POST /api/zalo/admin?op=set-webhook    URL derived from the request origin
```

Local development: `node scripts/zalo-poll.mjs [--forward]` prints everything the dev bot receives
and can replay it into a local server. It calls `deleteWebhook` first, which is why it must never
be pointed at the production bot.

---

## Traps

Four faults cost a day between them. Each was individually invisible; the first three all produced
"nothing happens, no error anywhere".

**1. Cloudflare blocks Zalo's webhook agent — the reason inbound is polled.**
Zalo delivers with `User-Agent: Java/1.8.0_192`, and Cloudflare's browser-integrity check answers
that exact signature with **error 1010**, a 403 the Worker never sees and cannot log. Proven by
replaying Zalo's headers: `Java/1.8.0_192` → 403, `Java/17.0.1` → 200, `SomeBot/1.0` → 200, and
Zalo's odd `Accept` header alone → 200. It is the user-agent, nothing else. None of it is
configurable on `*.workers.dev`.

*The fix, when the app gets a custom domain:* a Configuration Rule disabling Browser Integrity
Check for `/api/zalo/webhook`, then `?op=poll-stop` and `?op=set-webhook`. That retires the
round-the-clock polling and the single-consumer constraint with it.

**2. The webhook and `getUpdates` disagree about the envelope.**

```
webhook     {"event_name":"message.text.received","message":{...}}      ← bare
getUpdates  {"ok":true,"result":{"event_name":"...","message":{...}}}   ← wrapped
```

Parsing for `result` alone meant every real delivery was answered **200 and dropped** — a silent
success indistinguishable from never being called. `unwrapUpdate` takes both, and logs a shape it
does not recognise rather than discarding it.

**3. A bot token with trailing whitespace 404s.**
The token goes in the URL **path**, so one newline — what `echo "$T" | wrangler secret put` stores
— makes every request `Not Found`, which reads as a routing bug rather than a credential one. The
three error shapes are the only way to tell from outside:

| Cause | Zalo's answer |
|---|---|
| malformed token | `Not Found` 404 |
| wrong token | `Unauthorized` 401 |
| bad chat_id | `The chat_id is invaild` 410 |

Both the token and the webhook secret are trimmed at their seams.

**4. `/api/*` is bearer-only.**
Everything under that prefix authenticates by `Authorization: Bearer` and nothing else. The share
cards are browser pages holding a session cookie, so the upload endpoint got a 401 on every click
— reported by the client as "could not create the image", which sent the search to the renderer.
It now lives at `/zalo-send-card` with `requireStaffCookieOrBearer`, and rasterizing failures are
reported separately from send failures. `app/routes/garden-month.tsx` exists for the same reason.

**Also worth knowing:** `getUpdates` has no `offset`. It is a live long-poll with no cursor, so a
message sent while nothing is listening is gone for good. And chat ids are **per bot** — a chat
paired to one bot is invisible to another, so switching bots means everyone re-pairs.

---

## Security notes

- **`/zalo-media/:key` is unauthenticated by necessity.** `sendPhoto` takes a URL that Zalo's
  servers fetch with no credential they could present. What stands in for auth is an unguessable
  v4 UUID — a capability URL. It can only reach the `zalo/` prefix, and objects are pruned after
  seven days by the daily job, so a leaked URL stops working.
- **The webhook route is gated on `X-Bot-Api-Secret-Token`**, compared in constant time. An unset
  secret rejects everything rather than defaulting open.
- **A pairing code is a credential** — anyone holding it can attach their chat to that person's
  notifications. Hence single-use, 24-hour expiry, and the context check.
- The bot token is never logged; failures are reported by method name only.

---

## Known limits

- **No conversation.** `/link` and `/unlink` are the whole vocabulary. Obvious additions, each a
  handler in `handleUpdate` over services that already exist: `/help` (nothing advertises the
  commands today), `/lichhoc` (next sessions), `/hocphi` (this month's fees). `/help` is the safe
  one to add first — a bot that answers questions is a bot people will ask questions of.
- **Cron cannot send images.** Share cards are drawn from live DOM by `html-to-image` and a Worker
  has no DOM, so automated group posts are text; the cards are always a button.
- **A student link is ambiguous** — the app cannot tell whether the parent or the student redeemed
  the code. That is why fee slips demand a `parents` record. If entering one per family proves too
  much friction, the alternative is to ask at pairing time who is redeeming and record it.
- **No per-family preferences.** Push recipients get their own preferences since migration 0043,
  but a Zalo chat is paired to a parent record or a class group — neither of which is an account —
  so there is nothing to hang a preference on. Zalo still follows the school-wide values
  (`notif-prefs.ts`), and a family can only opt out by unlinking.
