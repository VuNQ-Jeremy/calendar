# Backlog

What is left to build, ranked. One file so new work has somewhere to land — before this existed,
open items were scattered across `README.md`, `REFACTOR_PLAN.md`, `docs/mobile-parity.md` and an
audit's unchecked boxes, and the garden feature shipped web-only without anyone recording it.

Scope note: **`video/BACKLOG.md` stays where it is.** It is a full production plan for the video
catalog (seven guides, shorts, pipeline work) and is too detailed to inline here. Item 2 below is
its one-line summary.

Rules for this file: items are ordered by value, not by area. When an item ships, delete it and let
`CHANGELOG.md` carry the record. When something is deliberately *not* being built, it does not
belong here — put the reason in `docs/mobile-parity.md` or the relevant doc, which is where the
"knowingly not built" decisions live.

---

## 1. The garden is web-only

`shared/logic/garden.ts` and eight `/api/garden/*` endpoints are complete and documented
(`docs/api.md`, "The garden"), but there is **no garden anywhere under `mobile/`** — no screen, no
tab, nothing. It shipped 2026-08-06, after `docs/mobile-parity.md` was written, so that document
still claims full parity and is currently wrong.

This ranks first because the garden is the one student-facing feature in the app, and students are
the ones holding phones. A vocabulary reward loop that only appears on a laptop mostly does not
appear.

*Needs:* no backend work — the API and the pure logic are done and unit-tested. The real work is
`src/garden/plant-art.tsx`, which is DOM SVG and has to be re-rendered for React Native, plus
screens for the personal plant, the class garden with its cooperative tree, harvest, and the album.
Watch the settle-on-read contract: plants are derived, never stored, so a mobile client must not
cache a plant across a day boundary (`docs/api.md`).

**~1–2 days.** Add the parity entry to `docs/mobile-parity.md` first; that is five minutes and stops
the doc lying.

## 2. The video catalog past guide #1

`guide-calendar-basics` is built and proves the pipeline end to end. Guides 2–7, the shorts and the
changelog videos are all planned and none are started — see **`video/BACKLOG.md`** for the
storyboards, the per-guide hazards (the theme drawer and attendance both write on every
interaction) and the two open blockers.

**~half a day per guide.** Best starting points: Học phí (#4) for marketing value, Điểm danh (#2)
for being the shortest.

## 3. Student rankings on mobile

Web-only since 2026-08. Already recorded as "just not built yet" in `docs/mobile-parity.md`, and
genuinely cheap: the scoring is pure functions in `shared/logic/rankings.ts` with unit tests, and
the weights are a plain `settings` row under `ranking-weights`. One screen plus an `/api/rankings`
endpoint, no logic to reimplement.

**~2–3 hours.**

## 4. Parent login

`userFromToken` returns `null` for any account carrying a `parentId`
(`server/services/auth.ts:118`, "parent accounts remain unsupported"). A parent invite code
redeems, a password is set, and the person still cannot sign in — so both clients have to
apologise for it in the UI.

This is the single blocker under the parent portal, the standing "design-aware, don't build yet"
item in `README.md` and `REFACTOR_PLAN.md`. When it ships, delete the restriction in
`mobile/components/InvitesPanel.tsx` and the note in `mobile/app/(app)/people/parent/[id].tsx`.

**~1 day** for login itself; the portal is its own project.

## 5. Smaller, unranked

Ordered by how much they annoy, not by value.

- **Ten audit checks still unverified** — `docs/audit-2026-07-29.md` has 18 of 28 done; the rest
  need a real device, emulator, browser or live round-trip rather than code. ~1 hour with a phone
  in hand.
- **Per-user notification preferences** (phase 6.5) — prefs currently sit in the school-wide
  `settings` table because it is keyed by one string. Per-account needs a `user_settings` table: a
  migration and a service, not a screen. Boundary noted in `server/services/notif-prefs.ts`.
- **The i18n unused-key pass** — 83 keys in `docs/i18n-unused-keys.md`, most of them false
  positives from dynamic prefixes. Deliberately slow: hand-verify one family at a time and delete
  from both locales together. Do **not** bulk-prune. ~2 hours, low value.
- **Two stale plan docs** — `docs/plans/rankings.md` has 14 unchecked steps that all shipped in
  v0.0108–v0.0109; `plans/scrollbar-styling.md` and `docs/navigation-latency-plan.md` read as
  proposals but describe live code (`uiPrefs.scrollbar`, the SWR route cache). Mark them done so
  they stop reading as open work.
