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
    if (!room) return new Response('not found', { status: 404 });

    const players = (await this.ctx.storage.get<Record<string, StoredPlayer>>('players')) ?? {};
    const known = Boolean(players[userId]);

    if (!known) {
      if (room.phase !== 'lobby') return new Response('already started', { status: 409 });
      if (Object.keys(players).length >= PVP_MAX_PLAYERS) {
        return new Response('full', { status: 403 });
      }
      players[userId] = { name, kind, score: 0, correct: 0, joinedAt: new Date().toISOString() };
      await this.ctx.storage.put('players', players);
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies SocketTag);

    if (room.phase === 'lobby') {
      await this.broadcastLobby(room, players);
    } else if (room.phase === 'question') {
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
      const key = `answers:${room.qIndex}`;
      const answers = (await this.ctx.storage.get<Record<string, StoredAnswer>>(key)) ?? {};
      if (answers[tag.userId]) return;
      answers[tag.userId] = { option: msg.option, ms: Date.now() };
      await this.ctx.storage.put(key, answers);

      const players = (await this.ctx.storage.get<Record<string, StoredPlayer>>('players')) ?? {};
      if (Object.keys(answers).length >= Object.keys(players).length) {
        await this.ctx.storage.deleteAlarm();
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
    const next: RoomState = { ...room, phase: 'reveal' };
    await this.ctx.storage.put('room', next);
    const revealDeadline = Date.now() + PVP_REVEAL_MS;
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

  private async broadcastLobby(
    room: RoomState,
    players: Record<string, StoredPlayer>,
  ): Promise<void> {
    this.broadcast({
      type: 'lobby',
      code: room.code,
      config: room.config,
      players: Object.entries(players).map(([id, p]) => ({ id, kind: p.kind, name: p.name })),
      hostId: room.hostId,
    });
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
