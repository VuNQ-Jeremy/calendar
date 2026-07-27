# Phase 6 — Push notifications

**Depends on:** Phase 2 (technically). Needs Phase 3 and 4 for the content worth notifying about
**Touches:** `mobile/`, `workers/app.ts`, `wrangler.jsonc`, new `server/services/push.ts`,
`app/routes/api.push.*.tsx`
**Risk:** low-medium — the moving parts are simple, but it cannot be tested in Expo Go
**Deliverable:** homework reminders, class-starting alerts, and study nudges on the lock screen.

## Why this is the strongest argument for going native

Everything else in this project a well-built PWA could have done. Push on Android is the
capability that justifies the whole Expo decision — an app that reaches the user when it is
*not* open. Homework due tomorrow, class starting in 30 minutes, a study streak about to break.

It is scheduled last because notifying users about content is pointless until the content
screens exist. It can slot in immediately after Phase 3 if the student-only app ships first.

---

## Task 6.1 — Device registration (mobile)

`expo-notifications`, configured via the plugin already added in Phase 2's `app.json`.

Flow:

1. **Ask for permission at the right moment** — not on first launch. Ask after the user
   completes their first game (Phase 3) or opens their first class (Phase 4), with a short
   in-app explanation of what they will receive. A cold permission prompt gets denied, and on
   Android 13+ (`POST_NOTIFICATIONS`) a denial is sticky.
2. On grant → `Notifications.getExpoPushTokenAsync({ projectId })` → `POST /api/push/register`
   with `{ expoToken, platform: 'android' }`.
3. On logout → `POST /api/push/unregister`, then clear the local token.
4. Re-register on every login — Expo tokens rotate, and the same device may serve different
   accounts.

**Android channels** — create these explicitly. Android groups notifications by channel and the
user can mute each one independently:

| Channel | Importance | Used for |
|---|---|---|
| `reminders` | HIGH | Class starting soon |
| `homework` | DEFAULT | Homework due tomorrow |
| `study` | LOW | Daily study nudge |

Set the notification icon (white-on-transparent — Android tints it) and the brand color, both
already declared in the Phase 2 `app.json` plugin config.

**Tapping a notification must deep-link to the right screen** — the event, the homework, the
topic. Use `expo-router`'s linking with the `mochi://` scheme set in Phase 2. A notification
that opens the home screen is a notification users learn to ignore.

---

## Task 6.2 — Server storage

The `push_tokens` table already exists from Phase 1's migration `0014_mobile.sql`:

```
id, account_id, expo_token (UNIQUE), platform, created_at, last_seen_at
```

New `server/services/push.ts`:

```ts
export async function registerToken(db: Db, accountId: string, expoToken: string, platform: string)
export async function unregisterToken(db: Db, expoToken: string)
export async function tokensForAccounts(db: Db, accountIds: string[]): Promise<string[]>
export async function sendPush(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>
```

`registerToken` must **upsert on `expo_token`** — reinstalling the app or switching accounts on
the same device must move the token to the new account, not create a duplicate row. The unique
constraint enforces this; use `ON CONFLICT(expo_token) DO UPDATE`.

Routes `app/routes/api.push.register.tsx` and `api.push.unregister.tsx`, both `requireApiUser`,
validated with `PushRegisterInput` (added to `shared/schemas.ts` in Phase 1).

---

## Task 6.3 — Sending from the Worker

Expo's push service is a plain HTTP POST — no SDK needed, no credentials, works fine from
workerd:

```
POST https://exp.host/--/api/v2/push/send
Content-Type: application/json
Body: an array of up to 100 messages
[{ to: 'ExponentPushToken[…]', title, body, data: { … }, channelId: 'homework' }]
```

**Batch at 100 messages per request.** A school of a few hundred accounts is one or two calls.

**Handle the receipts.** The response contains per-message tickets. When a ticket's error is
`DeviceNotRegistered`, **delete that row from `push_tokens`** — otherwise the table fills with
dead tokens from uninstalled apps and every send gets slower. This is the one piece of push
plumbing that is always skipped and always regretted.

> **This does not go through `TRANSLATE_DO`.** That Durable Object exists solely because
> Anthropic 403s Cloudflare's Hong Kong egress. Expo's push service has no such restriction.
> Call it directly from the Worker.

---

## Task 6.4 — Scheduling

Add Cron Triggers to `wrangler.jsonc` (available on the free Workers plan):

```jsonc
"triggers": { "crons": [
  "*/15 * * * *",   // class-starting-soon sweep
  "0 1 * * *"       // 01:00 UTC = 08:00 Vietnam (ICT, UTC+7) — daily digest
]}
```

Add a `scheduled(event, env, ctx)` export to `workers/app.ts` alongside the existing `fetch`
handler. Branch on `event.cron` to pick the job.

### Job A — class starting soon (every 15 min, `reminders` channel)

Query `events` (plus `class_schedule`-derived occurrences) starting in the next 30 minutes.
Notify the enrolled students and the class's staff.

**Recurrence matters here.** An event with `recurrence: 'weekly'` has one row but many
occurrences. Use the same expansion logic as the UI — `expandEvents`, moved to
`@shared/logic/recurrence` in Phase 0. If the cron job and the calendar disagree about when a
class happens, users get notified for classes that are not running.

**Idempotency:** a 15-minute cron with a 30-minute window will match the same event twice.
Track what has been sent — a `sent_notifications (key, sent_at)` table keyed on
`{eventId}:{occurrenceDate}:{kind}`, or a short-TTL marker in the `settings` table. **Do not
skip this.** Duplicate class alerts are the fastest way to get an app's notifications muted.

### Job B — daily digest (01:00 UTC = 08:00 ICT)

- **Homework due tomorrow** → the students in that class (`homework` channel).
- **Study nudge** → students with no `flashcard_results` row in the last N days
  (`study` channel). Keep this gentle and infrequent; it is the one notification with no
  external deadline behind it, and the easiest to resent.

**Timezone:** the whole user base is in Vietnam (ICT, UTC+7, no DST). Hardcoding the offset is
acceptable and simpler than a timezone column — but **write the assumption down in a comment**
so it is findable if the school ever opens a second location.

---

## Task 6.5 — Preferences

Per-user notification settings on the Profile screen, stored in the existing `settings` k/v
table (the same one holding the calendar theme and UI prefs):

- Class reminders — on/off, and how many minutes before
- Homework reminders — on/off
- Study nudges — on/off

Respect them in the cron jobs. Also add a "Notifications" row in the More screen linking
straight to the Android system settings for the app (`Linking.openSettings()`) — when a user has
denied permission at the OS level, no amount of in-app toggling helps, and the app should say so
plainly rather than silently sending nothing.

---

## Acceptance criteria

- [ ] Permission is requested contextually, not on first launch, with an explanation.
- [ ] Granting registers a token; the `push_tokens` row exists with the right `account_id`.
- [ ] Logging out unregisters it. Logging in as a different user on the same device **moves**
      the token (one row, not two).
- [ ] All three Android channels appear in the system notification settings and can be muted
      independently.
- [ ] A manually triggered send delivers to a physical device with the app **closed**.
- [ ] Tapping each notification type deep-links to the correct screen.
- [ ] The class-starting cron fires once per occurrence — **let it run across at least three
      cron ticks and confirm exactly one notification**.
- [ ] A weekly recurring class triggers a reminder on every occurrence, matching what the
      calendar shows.
- [ ] The daily digest fires at 08:00 Vietnam time.
- [ ] Turning a preference off stops that notification type.
- [ ] Uninstalling the app and sending again produces a `DeviceNotRegistered` ticket and the row
      is deleted.
- [ ] Committed and pushed to `main`.

## Notes for the executor

- **Push cannot be tested in Expo Go.** Use the `development` or `preview` APK from Phase 2.
  This trips people up for an hour every time.
- Test cron logic behind a temporary authenticated debug endpoint before wiring it to the
  schedule — waiting 15 minutes per iteration is a miserable feedback loop. Delete the endpoint
  before finishing the phase.
- `wrangler tail` shows live Worker logs including scheduled invocations. Use it; the app
  already has `observability.enabled: true` in `wrangler.jsonc`.
- Notification fatigue is the real failure mode here, not delivery. Ship the three types
  above and no more. Every additional notification devalues the others, and users mute at the
  channel or app level — which silently kills the ones that mattered.
