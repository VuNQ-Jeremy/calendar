# Backlog

What is left to build, ranked. One file so new work has somewhere to land — before this existed,
open items were scattered across `README.md`, `REFACTOR_PLAN.md`, `docs/mobile-parity.md` and an
audit's unchecked boxes, and the garden feature shipped web-only without anyone recording it.

The garden was the first item here and shipped on 2026-08-07 (student half). Its staff half is
deliberately not coming to the phone — that decision, and why, is in `docs/mobile-parity.md` under
"Deliberate omissions", which is where reasons live rather than here.

Scope note: **`video/BACKLOG.md` stays where it is.** It is a full production plan for the video
catalog (seven guides, shorts, pipeline work) and is too detailed to inline here. Item 1 below is
its one-line summary.

Rules for this file: items are ordered by value, not by area. When an item ships, delete it and let
`CHANGELOG.md` carry the record. When something is deliberately *not* being built, it does not
belong here — put the reason in `docs/mobile-parity.md` or the relevant doc, which is where the
"knowingly not built" decisions live.

---

## 1. The video catalog past guide #1

`guide-calendar-basics` is built and proves the pipeline end to end. Guides 2–7, the shorts and the
changelog videos are all planned and none are started — see **`video/BACKLOG.md`** for the
storyboards, the per-guide hazards (the theme drawer and attendance both write on every
interaction) and the two open blockers.

**~half a day per guide.** Best starting points: Học phí (#4) for marketing value, Điểm danh (#2)
for being the shortest.

## 2. Student rankings on mobile

Web-only since 2026-08. Already recorded as "just not built yet" in `docs/mobile-parity.md`, and
genuinely cheap: the scoring is pure functions in `shared/logic/rankings.ts` with unit tests, and
the weights are a plain `settings` row under `ranking-weights`. One screen plus an `/api/rankings`
endpoint, no logic to reimplement.

**~2–3 hours.**

## 3. Walkthrough follow-through: mobile journeys and an automated prod tour

The admin walkthrough that shipped covers only the web app's 27 stories, and it has never been run
by a human yet. Two follow-ups are deliberately deferred until it survives at least one real manual
pass — running it once is what will show whether the story catalogue is even accurate, and building
more on top of an unverified catalogue would just multiply the rework.

- **Mobile walkthrough journeys** — the phone app's own stories (flashcards and the offline queue,
  the garden, PvP) aren't covered by this release. Automating them means Maestro
  (`cd mobile && npm run test:device`), not Playwright — a different toolchain, not more of the
  same e2e spec pattern.
- **An automated prod tour** — a future `e2e/tour-*.spec.ts` family that walks the same catalogue
  unattended against production, read-mostly and self-cleaning, standing in for the human-driven
  checklist once the catalogue is trusted.
- **Trim the layout chunk** — the tour driver and the 27-story catalogue are statically imported by
  `app/routes/_app.tsx`, so roughly 8KB gzipped rides on the shell every authenticated user loads,
  students and parents included, for whom it is dead weight. Gate the mount on `?tour=` being present
  and `React.lazy` the driver once the catalogue has settled from its first manual pass.

**~1 day for the Maestro pass, ~half a day for a first automated-tour spec** — both blocked on the
manual pass landing, not on effort.

## 4. Smaller, unranked

Ordered by how much they annoy, not by value.

- **Ten audit checks still unverified** — `docs/audit-2026-07-29.md` has 18 of 28 done; the rest
  need a real device, emulator, browser or live round-trip rather than code. ~1 hour with a phone
  in hand.
- ~~**Per-user notification preferences** (phase 6.5)~~ — DONE, migration 0043. `user_settings`
  now holds one row per (account, key) and the four switches are applied per recipient by the cron.
  `classLeadMinutes` is deliberately still school-wide: it decides when a sweep FIRES, and the
  ledger keys carry no recipient, so a per-person lead would mean a per-person ledger. The Zalo
  audience stays school-wide for a structural reason — parents and group chats are not accounts.
- **The i18n unused-key pass** — 83 keys in `docs/i18n-unused-keys.md`, most of them false
  positives from dynamic prefixes. Deliberately slow: hand-verify one family at a time and delete
  from both locales together. Do **not** bulk-prune. ~2 hours, low value.
- **Two stale plan docs** — `docs/plans/rankings.md` has 14 unchecked steps that all shipped in
  v0.0108–v0.0109; `plans/scrollbar-styling.md` and `docs/navigation-latency-plan.md` read as
  proposals but describe live code (`uiPrefs.scrollbar`, the SWR route cache). Mark them done so
  they stop reading as open work.
