# Vocab Arena — PvP vocabulary battles (F33 + F34)

Design spec, 2026-08-25. Feedback F33 ("PvP for vocabulary") and F34 ("1234 games
ideas/integration — local wifi hosting"), GitHub issues #31/#32. A published artifact
("Vocab Arena") mirrors this document.

## Why

Two feedback ideas, one system. F33 asks for player-vs-player vocabulary. F34 points at
the app *1 2 3 4 Player Games* — pick a simple game from a menu and duel a friend — and
suggests "local wifi hosting". The existing 13 vocab game modes are all strictly
single-player, and the strongest motivation lever the app has (garden, rankings,
assignments) never touches head-to-head play. The product model is the classroom moment:
the shared countdown, the reveal, the leaderboard gasp.

## Decisions

### Rejected permanently: local wifi / LAN hosting

Phone-hosted LAN play needs native TCP + mDNS modules, which means a new APK on every
student phone (no OTA path). School routers commonly enable AP client isolation, silently
blocking phone-to-phone traffic — the game would work at home and fail in class. LAN
excludes anyone on 4G, and it is untestable in the suite. Classroom internet is confirmed
reliable, so server rooms have strictly *fewer* real-world preconditions, not more.

### Chosen: server-hosted rooms in a `GameRoom` Durable Object

One DO instance per room (`idFromName('t:<tenantId>:<code>')` — tenant fencing is
structural, same as LiveHub). WebSocket Hibernation API. React Native's built-in
WebSocket connects with the same bearer token as HTTP — pure JS, ships via normal OTA,
no runtimeVersion bump. LiveHub itself is untouched; it stays the one-way invalidation
hub.

### Chosen: both social shapes, one primitive — join-by-code

A teacher-hosted classroom battle (code on the projector, web host screen) and a student
duel (the kid next to you reads you the code) are the *same room* with a different host.
No matchmaking, no invites, no push notifications in v1 — the code shared in person is
the whole social mechanic.

### Chosen: questions built server-side, answers never sent early

The quiz builders use `Math.random()`, so each client would generate different questions.
The Worker builds one question list per room from `shared/logic/flashcards.ts`; the wire
format carries options only — the answer stays inside the DO until the reveal, so web
devtools can't cheat.

### Chosen: results ride the existing rails; the DO owns only the match

Each player posts their own standard `GameResult` after the battle (mobile outbox, web
`record-result` intent) — so mastery, garden and assignments work with zero new server
logic, at the same trust level as solo play. The DO writes one authoritative
`pvp_matches` record for the ladder.

### Chosen: public monthly ladder, farm-resistant, no Elo yet

Win = 3 points, playing = 1; at most 10 counted matches per student per ICT day; the
ladder resets monthly, matching the school's existing rankings rhythm so nobody is
permanently bottom. Elo-style ratings are deferred until real play shows they're needed.
Staff may play but never rank.

### Chosen: tabletop 1v1 face-off on the teacher's tablet (same-device, no network)

The literal *1 2 3 4 Player Games* model, realized: two students face off on ONE tablet
lying flat between them, each holding a SHORT edge. The screen splits left/right along the
long axis; each half is rotated 90° so its letter tops point away from its player (left half
`rotate(90deg)`, right half `rotate(-90deg)`) so each reads their own half upright while the
opponent's text runs sideways, by design. No GameRoom, no WebSocket, no server round-trip
during play — questions are built client-side from the same shared builders, because there
is only one client. It lives on the web app (the teacher's tablet), route `/faceoff/:slug`,
launched from the same Battle dialog as room battles. The teacher picks one of two games on
the setup step; both survive a rematch.

**Duel** (`mode: 'quiz-faceoff'`) — one shared question at a time. A slim vertical divider
in the middle carries both progress bars back-to-back — almost touching — each filling
toward the win line, with the question counter and scores. Both halves show the SAME
question simultaneously; the first correct tap takes the point, a wrong tap locks that
player out until the next question (anti-spam), and both-locked advances with no point.
First to 5 points wins (`FACEOFF_TARGET`), out of at most 13 questions
(`FACEOFF_MAX_QUESTIONS`); exhausting the questions ends the duel on the higher score, and a
tie is a draw.

**Race** (`mode: 'quiz-race'`) — each side runs the SAME preset-count question list
(`RACE_QUESTION_COUNTS`, default `RACE_DEFAULT_QUESTIONS`) at its own position, against one
shared countdown (`RACE_SECONDS_CHOICES`, default `RACE_DEFAULT_SECONDS`) started when the
match starts. Progress is independent per side — a fast player is not blocked by the other's
pace — and a wrong tap costs only the tapper (a self-only cooldown), never the opponent.
Winner is whoever finishes their list first; if the clock runs out first, whoever has cleared
more questions wins. A tie (same progress at time-up, or both unfinished at equal counts) is
a draw and, like Duel, is not recorded.

Recording: when the teacher picked the two students before starting (optional roster
pickers, staff only), the finished match posts one `pvp_matches` row (`mode: 'quiz-faceoff'`
for Duel or `'quiz-race'` for Race, `code: '1V1'` for both — no room ever existed either
way — winner rank 1 / loser rank 2) so the ladder counts it — 3/1 points like any match.
Draws are not recorded for either game. Face-off writes NO mastery/garden results for either
game: the session belongs to the teacher, not the players, and shared-device speed tapping
is not the student's own practice. Anonymous quick-play (no students picked) records nothing
and is what signed-in students get on their own devices.

### Chosen: v1 game menu is quiz race only

The room protocol carries a `mode` field so the other racers (picture, match, cloze…)
slot in later — F34's "pick a game" hub is the follow-up, not the first release.
`pronounce` is excluded forever: every assessment is a paid Azure call. `flip` has no win
condition.

## How a battle runs

1. **Create.** Teacher (web) or student (phone) opens a topic → Battle → picks round size
   and seconds-per-question. The Worker builds the questions, initializes the DO, returns
   a 4-letter code.
2. **Join.** Players enter the code. Everyone in the lobby sees the player list grow
   live. Up to 40 players.
3. **Race.** Host presses Start. Every screen shows the same question with a shared
   deadline. Correct = 500 points + up to 500 speed bonus. When everyone has answered —
   or time runs out — the answer is revealed with a live leaderboard.
4. **Podium.** Final standings everywhere (big type on the teacher's projector view). The
   DO writes the match; each student's client quietly posts a normal round result, so
   plants grow and assignments tick exactly as if they'd studied solo.
5. **Ladder.** The vocabulary page shows this month's PvP ladder — points, wins, matches.
   It resets on the 1st (ICT).

Alternative flow — **tabletop face-off**: teacher opens a topic on the tablet → Battle →
"1v1 on this device" → optionally picks the two students → the tablet goes on the table
between them → race to 5 → the winner's match lands on the ladder. No code, no joining,
no internet needed during play.

## Protocol

Client → server: `{type:'start'}` (host only, lobby only, ≥2 players);
`{type:'answer', index, option}` (once per question; early-advance when everyone has
answered).

Server → client: `lobby` (code, config, player list, host id — rebroadcast on every
join/leave); `question` (index, total, epoch-ms deadline, wire question — options, no
answer); `reveal` (the answer, who got it, live standings; 4s pause, then next);
`finish` (final standings; match persisted; sockets close after 60s); `room-error`
(`not_found` / `already_started` / `full` / `not_host`).

A known player who drops mid-game reconnects into the current question with their score
intact. Abandoned rooms expire on a 2-hour alarm so codes can't be squatted. All
message/view logic lives in `shared/logic/pvp.ts` — one tested reducer drives both the
web and mobile UIs.

## Architecture

- **Phones (Expo):** built-in WebSocket, bearer auth. Result → offline outbox, as today.
- **Web (RR7):** cookie auth. Host/projector screen + student play. Result →
  `record-result` intent.
- **GameRoom DO:** one per room. Hibernation sockets, alarms drive deadlines, holds the
  answers, grades, ranks, writes the match.
- **Worker routes:** `POST /api/game-rooms` (+ cookie twin `POST /game-rooms`) builds
  questions and inits the DO; `GET /api/pvp/ladder`; `/game-ws` upgrade (bearer OR
  session cookie; identity forwarded as URI-encoded headers — Vietnamese text can't ride
  raw HTTP headers).
- **D1:** `pvp_matches` + `pvp_match_players`, tenant-scoped, in the e2e reset sweep.

## Schema

```sql
CREATE TABLE pvp_matches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  topic_id TEXT NOT NULL REFERENCES flashcard_topics(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  played_at TEXT NOT NULL
);
CREATE INDEX idx_pvp_matches_tenant_played ON pvp_matches(tenant_id, played_at);

CREATE TABLE pvp_match_players (
  match_id TEXT NOT NULL REFERENCES pvp_matches(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
  staff_id TEXT REFERENCES staff(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  score INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (match_id, rank)
);
CREATE INDEX idx_pvp_match_players_student ON pvp_match_players(student_id);
```

`pvp_match_players` carries no `tenant_id`: rows are fenced by their match.

## Out of scope for v1

- LAN play — rejected outright, see Decisions.
- Other game modes in the battle menu — the protocol is ready for them.
- Matchmaking, invites, push notifications.
- Elo ratings — points-with-daily-cap first.
- Pronounce mode — never (paid Azure Speech per assessment; PvP multiplies call volume).
- Face-off on the mobile app — v1 face-off is web-only (the teacher's tablet runs the web
  app); an Expo tablet build can port the same shared reducer later.
- 3–4 player same-device splits — the 1v1 layout generalizes, but not in v1.

**Cost note:** nothing in this design touches a paid API. Rooms run on Durable Objects
with hibernating sockets (idle connections accrue no duration charges — the same property
that makes LiveHub viable on the free plan).
