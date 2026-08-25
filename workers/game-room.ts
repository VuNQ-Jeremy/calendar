import { DurableObject } from 'cloudflare:workers';
import { createRawDb } from '../server/db/internal';
import { sessionCookie } from '../server/session';
import { userFromToken } from '../server/services/auth';
import { pvpMatches, pvpMatchPlayers } from '../server/db/schema';
import {
  PVP_MAX_PLAYERS,
  PVP_REVEAL_MS,
  speedPoints,
  type ClientMsg,
  type PvpPlayer,
  type PvpPlayerKind,
  type PvpStanding,
  type RoomConfig,
  type ServerMsg,
  type WireQuizQuestion,
} from '../shared/logic/pvp';

/**
 * A join-by-code PvP battle room (F33/F34, see
 * docs/superpowers/specs/2026-08-25-vocab-pvp-design.md).
 *
 * Uses the WebSocket **Hibernation** API, same discipline as `workers/live-hub.ts`:
 *   - use ctx.acceptWebSocket(server), never server.accept();
 *   - handlers are class methods (webSocketMessage/Close/Error), not listeners;
 *   - per-socket state lives in serializeAttachment (survives eviction, 2 KB cap);
 *   - the constructor re-runs on every wake, so ALL room state lives in ctx.storage, never on
 *     `this` — a bare instance field would silently reset to its initial value on every wake.
 *
 * The answer to the current question is stored ONLY here — it never rides the wire in a
 * `question` message, because the wire format is visible in a browser's devtools and a client
 * that knew the answer ahead of time could not be trusted to play fair. It is revealed only in
 * the `reveal` broadcast, after every player has answered or the deadline passed.
 *
 * This DO writes the authoritative `pvp_matches` row on finish, but it NEVER writes mastery or
 * garden state: each player posts their own standard `GameResult` through the existing
 * offline-durable paths (mobile outbox, web `record-result` intent) — the same trust level as
 * solo play, with zero new server logic for those systems to learn.
 */

type Phase = 'lobby' | 'question' | 'reveal' | 'done';

type RoomState = {
  code: string;
  tenantId: string;
  hostId: string;
  config: RoomConfig;
  phase: Phase;
  qIndex: number;
  createdAt: string;
  /** The deadline (epoch ms) broadcast with the current question; used to grade + reconnects. */
  deadline: number;
};

type StoredPlayer = {
  name: string;
  kind: PvpPlayerKind;
  score: number;
  correct: number;
  joinedAt: string;
};

type StoredAnswer = { option: string; ms: number };

type SocketTag = { userId: string };

const EXPIRE_MS = 2 * 60 * 60 * 1000;
const CLOSE_AFTER_FINISH_MS = 60_000;

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/init') return this.handleInit(request);
    if (pathname === '/connect') return this.handleConnect(request);
    return new Response('not found', { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const body = (await request.json()) as {
      code: string;
      tenantId: string;
      config: RoomConfig;
      questions: { wire: WireQuizQuestion; answer: string }[];
      host: PvpPlayer;
    };

    const existing = await this.ctx.storage.get<RoomState>('room');
    if (
      existing &&
      existing.phase !== 'done' &&
      Date.now() - new Date(existing.createdAt).getTime() < EXPIRE_MS
    ) {
      return Response.json({ error: 'room_exists' }, { status: 409 });
    }

    await this.ctx.storage.deleteAll();
    const room: RoomState = {
      code: body.code,
      tenantId: body.tenantId,
      hostId: body.host.id,
      config: body.config,
      phase: 'lobby',
      qIndex: 0,
      createdAt: new Date().toISOString(),
      deadline: 0,
    };
    const players: Record<string, StoredPlayer> = {
      [body.host.id]: {
        name: body.host.name,
        kind: body.host.kind,
        score: 0,
        correct: 0,
        joinedAt: room.createdAt,
      },
    };
    await this.ctx.storage.put({ room, questions: body.questions, players });
    await this.ctx.storage.setAlarm(Date.now() + EXPIRE_MS);
    return Response.json({ ok: true });
  }

  private async handleConnect(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const userId = request.headers.get('X-Game-User');
    const kind = request.headers.get('X-Game-Kind');
    const nameHeader = request.headers.get('X-Game-Name');
    if (!userId || (kind !== 'staff' && kind !== 'student') || !nameHeader) {
      return new Response('unauthorized', { status: 401 });
    }
    const name = decodeURIComponent(nameHeader);

    const room = await this.ctx.storage.get<RoomState>('room');
    if (!room) return this.refuse('not_found');

    const players = (await this.ctx.storage.get<Record<string, StoredPlayer>>('players')) ?? {};
    const known = Boolean(players[userId]);

    if (!known) {
      if (room.phase !== 'lobby') return this.refuse('already_started');
      if (Object.keys(players).length >= PVP_MAX_PLAYERS) {
        return this.refuse('full');
      }
      players[userId] = { name, kind, score: 0, correct: 0, joinedAt: new Date().toISOString() };
      await this.ctx.storage.put('players', players);
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies SocketTag);

    if (room.phase === 'lobby') {
      await this.broadcastLobby(room, players);
    } else {
      // A socket joining mid-game may be a FRESH client (page refresh, app relaunch) whose view
      // starts at {phase:'connecting'}. `applyServerMsg` carries `config` forward from the
      // previous view, so without a `lobby` first it lands on `{} as RoomConfig` — silently
      // undefined `secondsPerQuestion`/`topicId`/`slug`, which breaks the countdown bar, the
      // "question N of M" header and, worst, the post-match GameResult that records mastery and
      // the garden. Always send `lobby` before the phase message; order matters.
      this.sendTo(server, this.lobbyMsg(room, players));
    }

    if (room.phase === 'question') {
      const questions =
        (await this.ctx.storage.get<{ wire: WireQuizQuestion; answer: string }[]>('questions')) ??
        [];
      const q = questions[room.qIndex];
      if (q) {
        this.sendTo(server, {
          type: 'question',
          index: room.qIndex,
          total: questions.length,
          deadline: room.deadline,
          question: q.wire,
        });
      }
    } else if (room.phase === 'reveal') {
      const questions =
        (await this.ctx.storage.get<{ wire: WireQuizQuestion; answer: string }[]>('questions')) ??
        [];
      const q = questions[room.qIndex];
      const answers =
        (await this.ctx.storage.get<Record<string, StoredAnswer>>(`answers:${room.qIndex}`)) ?? {};
      if (q) {
        const correctIds = Object.entries(answers)
          .filter(([, a]) => a.option === q.answer)
          .map(([id]) => id);
        this.sendTo(server, {
          type: 'reveal',
          index: room.qIndex,
          answer: q.answer,
          correctIds,
          standings: this.standingsOf(players),
        });
      }
    } else if (room.phase === 'done') {
      // Without this the connect still returns 101 and the client sits on "Connecting…" forever.
      // It is reliably reachable: the finish+60s alarm closes every socket and both clients treat
      // a close they did not initiate as reconnectable.
      this.sendTo(server, { type: 'finish', standings: this.standingsOf(players) });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    const tag = ws.deserializeAttachment() as SocketTag | null;
    if (!tag) return;
    const room = await this.ctx.storage.get<RoomState>('room');
    if (!room) return;

    if (msg.type === 'start') {
      if (tag.userId !== room.hostId) {
        this.sendTo(ws, { type: 'room-error', code: 'not_host' });
        return;
      }
      if (room.phase !== 'lobby') return;
      const players = (await this.ctx.storage.get<Record<string, StoredPlayer>>('players')) ?? {};
      if (Object.keys(players).length < 2) return;
      await this.startQuestion(room, 0);
      return;
    }

    if (msg.type === 'answer') {
      if (room.phase !== 'question' || msg.index !== room.qIndex) return;
      // `phase` stays 'question' until the alarm actually FIRES, and Cloudflare alarms are
      // eventual (a hibernated object must be woken first). Without this check an answer landing
      // in that window is scored with a negative msLeft, which speedPoints clamps to a zero
      // bonus — but it still banks the full 500 base points, while a classmate who honestly ran
      // out of time gets nothing.
      if (Date.now() > room.deadline) return;
      const questions =
        (await this.ctx.storage.get<{ wire: WireQuizQuestion; answer: string }[]>('questions')) ??
        [];
      const q = questions[room.qIndex];
      if (!q) return;
      // `msg.option` came off the wire: unvalidated it goes straight to storage, so an
      // authenticated student could post a 200 KB string, blow the 128 KiB per-value limit and
      // throw out of webSocketMessage.
      if (typeof msg.option !== 'string' || !q.wire.options.includes(msg.option)) return;
      const key = `answers:${room.qIndex}`;
      const answers = (await this.ctx.storage.get<Record<string, StoredAnswer>>(key)) ?? {};
      if (answers[tag.userId]) return;
      answers[tag.userId] = { option: msg.option, ms: Date.now() };
      await this.ctx.storage.put(key, answers);

      const players = (await this.ctx.storage.get<Record<string, StoredPlayer>>('players')) ?? {};
      if (Object.keys(answers).length >= Object.keys(players).length) {
        // No deleteAlarm() here: a DO has at most one alarm, and revealStep's setAlarm replaces
        // the question deadline anyway. Dropping the delete also means that if revealStep throws
        // half-way, the already-scheduled question alarm still fires and recovers the game
        // instead of leaving it stalled with no alarm at all. The double-award race that
        // deleteAlarm was meant to prevent is handled by revealStep's phase guard.
        await this.revealStep(room);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1006 ? 1000 : code, 'bye');
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      // Already closed.
    }
  }

  async alarm(): Promise<void> {
    const room = await this.ctx.storage.get<RoomState>('room');
    if (!room) return;

    // Self-healing: an alarm that arrives EARLY re-arms itself instead of advancing the game.
    // `deleteAlarm()` cannot cancel an alarm that has already fired, so without this a queued
    // alarm() can land milliseconds after an early-advance, read `phase === 'reveal'` and jump
    // straight to the next question — players never see the answer. The 50 ms slack absorbs
    // ordinary timer imprecision (an on-time alarm can report a `Date.now()` a hair below its own
    // deadline); any larger and a real deadline could be skipped, any smaller and an honest
    // alarm would bounce off the guard and re-arm for one extra round trip. `deadline` is 0 in
    // the lobby and already in the past when done, so those branches are unaffected.
    if (Date.now() < room.deadline - 50) {
      await this.ctx.storage.setAlarm(room.deadline);
      return;
    }

    if (room.phase === 'question') {
      await this.revealStep(room);
      return;
    }
    if (room.phase === 'reveal') {
      await this.nextOrFinish(room);
      return;
    }
    if (room.phase === 'done') {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, 'bye');
        } catch {
          // Already closed.
        }
      }
      // Without this every played match leaves `room`, `questions`, `players` and `answers:0…N`
      // in its DO forever — the 2h expiry branch below is unreachable for a done room. Safe only
      // because /connect now answers a `done`-phase reconnect (a client that comes back inside
      // the 60s window gets its standings; after that it gets a clean 404, not a spinner).
      await this.ctx.storage.deleteAll();
      return;
    }
    // Abandoned lobby: free the code rather than let it squat forever.
    if (Date.now() - new Date(room.createdAt).getTime() >= EXPIRE_MS) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, 'expired');
        } catch {
          // Already closed.
        }
      }
      await this.ctx.storage.deleteAll();
    }
  }

  // ---- Internal steps ----

  private async startQuestion(room: RoomState, qIndex: number): Promise<void> {
    const questions =
      (await this.ctx.storage.get<{ wire: WireQuizQuestion; answer: string }[]>('questions')) ?? [];
    const q = questions[qIndex];
    if (!q) {
      await this.finish(room);
      return;
    }
    const deadline = Date.now() + room.config.secondsPerQuestion * 1000;
    const next: RoomState = { ...room, phase: 'question', qIndex, deadline };
    await this.ctx.storage.put('room', next);
    await this.ctx.storage.setAlarm(deadline);
    this.broadcast({
      type: 'question',
      index: qIndex,
      total: questions.length,
      deadline,
      question: q.wire,
    });
  }

  private async revealStep(room: RoomState): Promise<void> {
    // Idempotence guard: the scoring loop below does `player.score += …` unconditionally, so a
    // second run for the same qIndex would double-award. `deleteAlarm()` cannot cancel an alarm
    // that has already fired, so a queued alarm() can land right after an early-advance.
    if (room.phase !== 'question') return;
    const questions =
      (await this.ctx.storage.get<{ wire: WireQuizQuestion; answer: string }[]>('questions')) ?? [];
    const q = questions[room.qIndex];
    if (!q) {
      await this.finish(room);
      return;
    }
    const answers =
      (await this.ctx.storage.get<Record<string, StoredAnswer>>(`answers:${room.qIndex}`)) ?? {};
    const players = (await this.ctx.storage.get<Record<string, StoredPlayer>>('players')) ?? {};
    const totalMs = room.config.secondsPerQuestion * 1000;
    const correctIds: string[] = [];
    for (const [userId, a] of Object.entries(answers)) {
      const player = players[userId];
      if (!player) continue;
      if (a.option === q.answer) {
        player.score += speedPoints(room.deadline - a.ms, totalMs);
        player.correct += 1;
        correctIds.push(userId);
      }
    }
    await this.ctx.storage.put('players', players);
    // The reveal's own end becomes the room's deadline, so alarm()'s early-arrival guard knows
    // when this phase is genuinely allowed to advance.
    const revealDeadline = Date.now() + PVP_REVEAL_MS;
    const next: RoomState = { ...room, phase: 'reveal', deadline: revealDeadline };
    await this.ctx.storage.put('room', next);
    await this.ctx.storage.setAlarm(revealDeadline);
    this.broadcast({
      type: 'reveal',
      index: room.qIndex,
      answer: q.answer,
      correctIds,
      standings: this.standingsOf(players),
    });
  }

  private async nextOrFinish(room: RoomState): Promise<void> {
    const questions =
      (await this.ctx.storage.get<{ wire: WireQuizQuestion; answer: string }[]>('questions')) ?? [];
    if (room.qIndex + 1 < questions.length) {
      await this.startQuestion(room, room.qIndex + 1);
      return;
    }
    await this.finish(room);
  }

  private async finish(room: RoomState): Promise<void> {
    const players = (await this.ctx.storage.get<Record<string, StoredPlayer>>('players')) ?? {};
    const standings = this.standingsOf(players);
    const done: RoomState = { ...room, phase: 'done' };
    await this.ctx.storage.put('room', done);
    this.broadcast({ type: 'finish', standings });
    await this.persistMatch(room, standings, players);
    await this.ctx.storage.setAlarm(Date.now() + CLOSE_AFTER_FINISH_MS);
  }

  /**
   * Write the authoritative match row. `createRawDb`, not a TenantDb: a Durable Object has no
   * request and no session — `tenantId` comes from the room state, which was set at /init from
   * the authenticated creator's session, never from client input.
   */
  private async persistMatch(
    room: RoomState,
    standings: PvpStanding[],
    players: Record<string, StoredPlayer>,
  ): Promise<void> {
    const db = createRawDb(this.env);
    const questions =
      (await this.ctx.storage.get<{ wire: WireQuizQuestion; answer: string }[]>('questions')) ?? [];
    const matchId = crypto.randomUUID();
    try {
      await db.insert(pvpMatches).values({
        id: matchId,
        tenantId: room.tenantId,
        code: room.code,
        topicId: room.config.topicId,
        mode: room.config.mode,
        playedAt: new Date().toISOString(),
      });
      await db.insert(pvpMatchPlayers).values(
        standings.map((s, i) => {
          const player = players[s.id];
          return {
            matchId,
            studentId: player?.kind === 'student' ? s.id : null,
            staffId: player?.kind === 'staff' ? s.id : null,
            rank: i + 1,
            score: s.score,
            correct: s.correct,
            total: questions.length,
          };
        }),
      );
    } catch (err) {
      // The players already have their standings on screen; a persistence failure here must
      // not un-finish the room for them. Nobody chose to write this row (unlike a feedback
      // report), so there is no audit entry to skip either — just log and move on.
      console.error('[game-room] persist match failed', { err: String(err) });
    }
  }

  private standingsOf(players: Record<string, StoredPlayer>): PvpStanding[] {
    return Object.entries(players)
      .map(([id, p]) => ({ id, name: p.name, score: p.score, correct: p.correct }))
      .sort((a, b) => b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name));
  }

  /** The `lobby` message — it is what carries `config` to a client, at any phase. */
  private lobbyMsg(room: RoomState, players: Record<string, StoredPlayer>): ServerMsg {
    return {
      type: 'lobby',
      code: room.code,
      config: room.config,
      players: Object.entries(players).map(([id, p]) => ({ id, kind: p.kind, name: p.name })),
      hostId: room.hostId,
    };
  }

  private async broadcastLobby(
    room: RoomState,
    players: Record<string, StoredPlayer>,
  ): Promise<void> {
    this.broadcast(this.lobbyMsg(room, players));
  }

  /**
   * Refuse a join: accept the socket, say why over the wire, then hang up.
   *
   * The three refusals that reach here (`not_found`, `already_started`, `full`) used to be a
   * bare HTTP status on the failed-upgrade response, which no client can read — it only sees
   * close code 1006, so a mistyped code burned all three reconnect attempts before reporting
   * "connection lost". Accepting the socket and sending `room-error` first makes the existing
   * protocol and both clients' existing copy for these codes reachable.
   *
   * We deliberately do NOT close synchronously here: closing before the 101 response has left
   * the Worker can race the `send` against the still-completing upgrade. The ordering guarantee
   * instead comes from `setTimeout(resolve, 0)` deferring the close past this tick, the same fact
   * the two sends already above rely on for a successful join (`sendTo` at :167/:207 happens
   * before the 101 at :210 is returned, and the client still receives them in order) — frames
   * queued on a socket before its 101 response is returned are still delivered to the client in
   * the order they were queued. `ctx.waitUntil` itself buys none of that ordering; it exists only
   * to keep this Durable Object alive long enough for the deferred close to actually run (and to
   * satisfy the no-floating-promises rule), the same role it plays in
   * `workers/translate-proxy.ts`. We still close from our side rather than leaving the socket open
   * indefinitely: it was never registered as a player, but `ctx.getWebSockets()` (which
   * `broadcast()` sends to unconditionally, with no player check) does not know that — for the
   * `already_started`/`full` cases the room is genuinely live, so an open-and-forgotten socket
   * would keep receiving `question`/`reveal`/`finish` traffic, and `applyServerMsg` switches on
   * every message type unconditionally, so that traffic would silently knock the client off the
   * error screen it just landed on. (Belt-and-braces only: both clients also close the socket
   * themselves the moment they see a terminal `room-error`, so this close does not have to land
   * for the client to be correct — see `roomErrorReceived` in `mobile/lib/game-socket.ts` and
   * `src/lib/game-socket.ts`.)
   */
  private refuse(code: 'not_found' | 'already_started' | 'full'): Response {
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    this.sendTo(server, { type: 'room-error', code });
    this.ctx.waitUntil(
      (async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        try {
          server.close(1000, 'refused');
        } catch {
          // The client already closed it first.
        }
      })(),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket is mid-close; webSocketClose/webSocketError reaps it.
    }
  }

  private broadcast(msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Socket is mid-close; webSocketClose/webSocketError reaps it.
      }
    }
  }
}

function bearerToken(request: Request): string | null {
  const h = request.headers.get('Authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/**
 * Handle the `/game-ws` upgrade. Mirrors `handleLiveUpgrade` in `workers/live-hub.ts`, but
 * accepts EITHER a mobile bearer token or a web session cookie (LiveHub is cookie-only, since
 * the web is its only client). Parents are refused: only staff and students play.
 */
export async function handleGameUpgrade(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected websocket upgrade', { status: 426 });
  }

  const db = createRawDb(env);
  const bearer = bearerToken(request);
  const user = bearer
    ? await userFromToken(db, bearer)
    : await (async () => {
        const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
        if (!rawToken || typeof rawToken !== 'string') return null;
        return userFromToken(db, rawToken);
      })();
  if (!user) return new Response('unauthorized', { status: 401 });
  if (user.kind === 'parent') return new Response('forbidden', { status: 403 });

  const codeRaw = new URL(request.url).searchParams.get('code') ?? '';
  const code = codeRaw.toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    return new Response('bad code', { status: 400 });
  }

  const forwarded = new Request('https://game-room.internal/connect', request);
  forwarded.headers.set('X-Game-User', user.user.id);
  forwarded.headers.set('X-Game-Kind', user.kind);
  forwarded.headers.set('X-Game-Name', encodeURIComponent(user.user.name));

  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(`t:${user.tenantId}:${code}`));
  return stub.fetch(forwarded);
}
