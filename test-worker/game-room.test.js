import { describe, it, expect } from 'vitest';
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as flashcardsSvc from '../server/services/flashcards';
import { pvpMatches, pvpMatchPlayers } from '../server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * The GameRoom Durable Object (workers/game-room.ts).
 *
 * Driven directly against the stub, the same way test-worker/live-hub.test.js drives LiveHub —
 * /game-ws's upgrade auth is a thin cookie/bearer wrapper covered by the same pattern that file
 * already exercises for LiveHub; what is worth proving here is the room's own state machine.
 * `runDurableObjectAlarm` fast-forwards the reveal-pause and deadline alarms rather than
 * waiting on wall-clock time.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

function freshRoom() {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(crypto.randomUUID()));
}

async function seedTopic() {
  const d = db();
  const words = [
    { word: 'cat', meaningVi: 'con mèo' },
    { word: 'dog', meaningVi: 'con chó' },
    { word: 'bird', meaningVi: 'con chim' },
    { word: 'fish', meaningVi: 'con cá' },
  ];
  return flashcardsSvc.createTopicWithWords(
    d,
    { name: `Room Test ${crypto.randomUUID()}`, description: null, color: 'orange' },
    words,
  );
}

function baseInitBody(topicId, overrides = {}) {
  const questions = [1, 2].map((n) => ({
    wire: {
      wordId: `w${n}`,
      prompt: 'text',
      promptText: `word${n}`,
      imagePath: null,
      options: ['a', 'b', 'c', 'd'],
    },
    answer: 'a',
  }));
  return {
    code: 'QZ4X',
    tenantId: PRIMARY_TENANT_ID,
    config: {
      topicId,
      topicName: 'Room Test',
      slug: 'room-test',
      mode: 'quiz',
      secondsPerQuestion: 20,
      totalQuestions: questions.length,
    },
    questions,
    host: { id: 'host-1', kind: 'staff', name: 'Teacher' },
    ...overrides,
  };
}

/**
 * Drive the room's next phase alarm.
 *
 * `alarm()` is self-healing: an alarm that arrives before `room.deadline` re-arms itself instead
 * of advancing the game (that guard is what stops a already-fired question alarm from cutting a
 * reveal short). `runDurableObjectAlarm` runs the alarm immediately, i.e. always "early", so
 * backdate the deadline first rather than waiting out the real 4-second reveal pause.
 */
async function runPhaseAlarm(stub) {
  await runInDurableObject(stub, async (_instance, state) => {
    const room = await state.storage.get('room');
    room.deadline = Date.now() - 1000;
    await state.storage.put('room', room);
  });
  return runDurableObjectAlarm(stub);
}

function connect(stub, userId, kind, name) {
  return stub.fetch('https://game-room.internal/connect', {
    headers: {
      Upgrade: 'websocket',
      'X-Game-User': userId,
      'X-Game-Kind': kind,
      'X-Game-Name': encodeURIComponent(name),
    },
  });
}

function listen(ws) {
  const received = [];
  ws.addEventListener('message', (ev) => received.push(JSON.parse(ev.data)));
  ws.accept();
  return {
    received,
    async waitFor(n, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (received.length < n) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${n} message(s); got ${received.length}`);
        }
        await scheduler.wait(10);
      }
      return received;
    },
  };
}

describe('GameRoom /init', () => {
  it('creates a fresh room', async () => {
    const topic = await seedTopic();
    const res = await freshRoom().fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(baseInitBody(topic.id)),
    });
    expect(res.status).toBe(200);
  });

  it('refuses to overwrite a live room', async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    const body = JSON.stringify(baseInitBody(topic.id));
    await stub.fetch('https://game-room.internal/init', { method: 'POST', body });
    const res = await stub.fetch('https://game-room.internal/init', { method: 'POST', body });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'room_exists' });
  });
});

describe('GameRoom /connect', () => {
  it('accepts the socket and sends a not_found room-error for an unknown code', async () => {
    const res = await connect(freshRoom(), 'u1', 'student', 'Vy');
    expect(res.status).toBe(101);
    const client = listen(res.webSocket);
    const [msg] = await client.waitFor(1);
    expect(msg).toEqual({ type: 'room-error', code: 'not_found' });
  });

  it('accepts the socket and sends a full room-error for a full lobby', async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(baseInitBody(topic.id)),
    });
    // Host already occupies one seat; PVP_MAX_PLAYERS is 40, so 39 more fills it exactly.
    for (let i = 0; i < 39; i++) {
      const res = await connect(stub, `student-${i}`, 'student', `S${i}`);
      expect(res.status).toBe(101);
    }
    const overflow = await connect(stub, 'one-too-many', 'student', 'Overflow');
    expect(overflow.status).toBe(101);
    const client = listen(overflow.webSocket);
    const [msg] = await client.waitFor(1);
    expect(msg).toEqual({ type: 'room-error', code: 'full' });
  });

  it('accepts the socket and sends an already_started room-error for a mid-game join', async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(baseInitBody(topic.id)),
    });
    const hostRes = await connect(stub, 'host-1', 'staff', 'Teacher');
    const host = listen(hostRes.webSocket);
    const studentRes = await connect(stub, 'student-1', 'student', 'Vy');
    listen(studentRes.webSocket);
    // Two lobby broadcasts land on the host: its own join, then the student's. `start` needs at
    // least 2 players in the room or it silently no-ops (see webSocketMessage's 'start' guard).
    await host.waitFor(2);
    hostRes.webSocket.send(JSON.stringify({ type: 'start' }));
    await host.waitFor(3);

    const late = await connect(stub, 'latecomer', 'student', 'Late');
    expect(late.status).toBe(101);
    const client = listen(late.webSocket);
    const [msg] = await client.waitFor(1);
    expect(msg).toEqual({ type: 'room-error', code: 'already_started' });
  });
});

describe('GameRoom full game', () => {
  it('plays two questions to finish and persists the match', async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    const init = baseInitBody(topic.id);
    await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(init),
    });

    const hostRes = await connect(stub, 'host-1', 'staff', 'Teacher');
    expect(hostRes.status).toBe(101);
    const host = listen(hostRes.webSocket);

    const studentRes = await connect(stub, 'student-1', 'student', 'Vy');
    expect(studentRes.status).toBe(101);
    listen(studentRes.webSocket);

    // Two lobby broadcasts land on the host: its own join, then the student's.
    await host.waitFor(2);

    hostRes.webSocket.send(JSON.stringify({ type: 'start' }));
    const [q0] = (await host.waitFor(3)).slice(2);
    expect(q0.type).toBe('question');
    expect(q0.index).toBe(0);

    // Host answers correctly and fast; student answers wrong. Both-answered early-advances.
    hostRes.webSocket.send(JSON.stringify({ type: 'answer', index: 0, option: 'a' }));
    studentRes.webSocket.send(JSON.stringify({ type: 'answer', index: 0, option: 'b' }));

    const [reveal0] = (await host.waitFor(4)).slice(3);
    expect(reveal0.type).toBe('reveal');
    expect(reveal0.correctIds).toEqual(['host-1']);
    const hostStanding = reveal0.standings.find((s) => s.id === 'host-1');
    expect(hostStanding.score).toBeGreaterThanOrEqual(500);
    expect(hostStanding.correct).toBe(1);

    // The reveal pause is alarm-driven; fast-forward it to advance to question 1.
    expect(await runPhaseAlarm(stub)).toBe(true);
    const [q1] = (await host.waitFor(5)).slice(4);
    expect(q1.type).toBe('question');
    expect(q1.index).toBe(1);

    hostRes.webSocket.send(JSON.stringify({ type: 'answer', index: 1, option: 'a' }));
    studentRes.webSocket.send(JSON.stringify({ type: 'answer', index: 1, option: 'a' }));

    const [reveal1] = (await host.waitFor(6)).slice(5);
    expect(reveal1.type).toBe('reveal');

    // The deck is exhausted; the next alarm finishes the match instead of another question.
    expect(await runPhaseAlarm(stub)).toBe(true);
    const [finish] = (await host.waitFor(7)).slice(6);
    expect(finish.type).toBe('finish');
    expect(finish.standings).toHaveLength(2);

    const rawDb = createRawDb(env);
    const matches = await rawDb.select().from(pvpMatches).where(eq(pvpMatches.code, 'QZ4X'));
    expect(matches).toHaveLength(1);
    expect(matches[0].mode).toBe('quiz');
    const players = await rawDb
      .select()
      .from(pvpMatchPlayers)
      .where(eq(pvpMatchPlayers.matchId, matches[0].id));
    expect(players).toHaveLength(2);
    const winner = players.find((p) => p.rank === 1);
    expect(winner.staffId).toBe('host-1');
  });

  it('lets a known player reconnect mid-game and resume at the current question', async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    const init = baseInitBody(topic.id);
    await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(init),
    });

    const hostRes = await connect(stub, 'host-1', 'staff', 'Teacher');
    listen(hostRes.webSocket);
    const studentRes = await connect(stub, 'student-1', 'student', 'Vy');
    const student = listen(studentRes.webSocket);
    await student.waitFor(1);

    hostRes.webSocket.send(JSON.stringify({ type: 'start' }));
    const original = (await student.waitFor(2))[1];
    expect(original.type).toBe('question');

    // The student "reconnects" — a fresh socket for the same known userId.
    const rejoinRes = await connect(stub, 'student-1', 'student', 'Vy');
    expect(rejoinRes.status).toBe(101);
    const rejoin = listen(rejoinRes.webSocket);
    const [lobby, resumed] = await rejoin.waitFor(2);

    // A `lobby` MUST come first, and it MUST carry the config: a client that mounts fresh
    // mid-game (page refresh, app relaunch) starts at {phase:'connecting'}, and applyServerMsg
    // only ever takes `config` from the previous view. Without this the countdown bar renders
    // `width: NaN%`, the header reads "of undefined", and the post-match GameResult posts to
    // /vocabulary/undefined — the round is never recorded at all.
    expect(lobby.type).toBe('lobby');
    expect(lobby.config.topicId).toBe(topic.id);
    expect(lobby.config.secondsPerQuestion).toBe(20);
    expect(lobby.config.slug).toBe('room-test');
    expect(lobby.config.totalQuestions).toBe(2);
    expect(lobby.hostId).toBe('host-1');
    expect(lobby.players.map((p) => p.id).sort()).toEqual(['host-1', 'student-1']);

    expect(resumed.type).toBe('question');
    expect(resumed.index).toBe(0);
    // The ORIGINAL deadline is replayed — a reconnect must not buy extra thinking time.
    expect(resumed.deadline).toBe(original.deadline);
  });

  it('answers a done-phase reconnect with the standings, then frees the storage', async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(baseInitBody(topic.id, { code: 'ZZ9Y' })),
    });

    const hostRes = await connect(stub, 'host-1', 'staff', 'Teacher');
    const host = listen(hostRes.webSocket);
    const studentRes = await connect(stub, 'student-1', 'student', 'Vy');
    listen(studentRes.webSocket);
    await host.waitFor(2);

    hostRes.webSocket.send(JSON.stringify({ type: 'start' }));
    await host.waitFor(3);
    hostRes.webSocket.send(JSON.stringify({ type: 'answer', index: 0, option: 'a' }));
    studentRes.webSocket.send(JSON.stringify({ type: 'answer', index: 0, option: 'b' }));
    await host.waitFor(4);
    expect(await runPhaseAlarm(stub)).toBe(true);
    await host.waitFor(5);
    hostRes.webSocket.send(JSON.stringify({ type: 'answer', index: 1, option: 'a' }));
    studentRes.webSocket.send(JSON.stringify({ type: 'answer', index: 1, option: 'a' }));
    await host.waitFor(6);
    expect(await runPhaseAlarm(stub)).toBe(true);
    const [finish] = (await host.waitFor(7)).slice(6);
    expect(finish.type).toBe('finish');

    // A client that comes back inside the finish+60s window used to sit on "Connecting…" forever:
    // the connect returned 101 and the DO sent it nothing at all.
    const rejoinRes = await connect(stub, 'student-1', 'student', 'Vy');
    expect(rejoinRes.status).toBe(101);
    const rejoin = listen(rejoinRes.webSocket);
    const [lobby, done] = await rejoin.waitFor(2);
    expect(lobby.type).toBe('lobby');
    expect(lobby.config.topicId).toBe(topic.id);
    expect(done.type).toBe('finish');
    expect(done.standings).toHaveLength(2);
    expect(done.standings[0].id).toBe('host-1');

    // The finish+60s alarm closes the sockets AND frees the room; every played match used to
    // leave room/questions/players/answers:0…N in its DO permanently.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const leftovers = await runInDurableObject(stub, (_instance, state) => state.storage.list());
    expect([...leftovers.keys()]).toEqual([]);
    const tooLate = await connect(stub, 'student-1', 'student', 'Vy');
    expect(tooLate.status).toBe(101);
    const tooLateClient = listen(tooLate.webSocket);
    const [tooLateMsg] = await tooLateClient.waitFor(1);
    expect(tooLateMsg).toEqual({ type: 'room-error', code: 'not_found' });
  });

  it('ignores an answer that lands after the question deadline', async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(baseInitBody(topic.id)),
    });

    const hostRes = await connect(stub, 'host-1', 'staff', 'Teacher');
    const host = listen(hostRes.webSocket);
    const studentRes = await connect(stub, 'student-1', 'student', 'Vy');
    listen(studentRes.webSocket);
    await host.waitFor(2);
    hostRes.webSocket.send(JSON.stringify({ type: 'start' }));
    await host.waitFor(3);

    // `phase` stays 'question' until the alarm actually fires, and Cloudflare alarms are
    // eventual — so a real client can land an answer in this window. Backdating the deadline
    // reproduces it deterministically.
    await runInDurableObject(stub, async (_instance, state) => {
      const room = await state.storage.get('room');
      room.deadline = Date.now() - 5000;
      await state.storage.put('room', room);
    });

    hostRes.webSocket.send(JSON.stringify({ type: 'answer', index: 0, option: 'a' }));
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const [reveal] = (await host.waitFor(4)).slice(3);
    expect(reveal.type).toBe('reveal');

    // Not merely un-bonused: not banked at all. speedPoints clamps a negative msLeft to a zero
    // bonus but still returns the full 500 base, so a late answer used to out-score a classmate
    // who honestly ran out of time.
    expect(reveal.correctIds).toEqual([]);
    expect(reveal.standings.every((s) => s.score === 0 && s.correct === 0)).toBe(true);
    const stored = await runInDurableObject(stub, (_instance, state) =>
      state.storage.get('answers:0'),
    );
    expect(stored).toBeUndefined();
  });

  it("ignores an option that is not one of the question's own options", async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(baseInitBody(topic.id)),
    });

    const hostRes = await connect(stub, 'host-1', 'staff', 'Teacher');
    const host = listen(hostRes.webSocket);
    const studentRes = await connect(stub, 'student-1', 'student', 'Vy');
    listen(studentRes.webSocket);
    await host.waitFor(2);
    hostRes.webSocket.send(JSON.stringify({ type: 'start' }));
    await host.waitFor(3);

    // Unvalidated, this 200 KB string went straight to storage — over D1/DO's 128 KiB per-value
    // limit, which throws out of webSocketMessage. It is also, deliberately, sent BEFORE a valid
    // answer: storage is first-write-wins, so if the junk were accepted it would occupy the
    // host's slot and the real answer below would be dropped as a duplicate.
    hostRes.webSocket.send(
      JSON.stringify({ type: 'answer', index: 0, option: 'x'.repeat(200_000) }),
    );
    hostRes.webSocket.send(JSON.stringify({ type: 'answer', index: 0, option: 'a' }));
    studentRes.webSocket.send(JSON.stringify({ type: 'answer', index: 0, option: 'b' }));

    const [reveal] = (await host.waitFor(4)).slice(3);
    expect(reveal.type).toBe('reveal');
    expect(reveal.correctIds).toEqual(['host-1']);
    const stored = await runInDurableObject(stub, (_instance, state) =>
      state.storage.get('answers:0'),
    );
    expect(stored['host-1'].option).toBe('a');
  });

  it('frees an abandoned lobby once its 2-hour alarm fires', async () => {
    const topic = await seedTopic();
    const stub = freshRoom();
    await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(baseInitBody(topic.id)),
    });

    // Backdate the room past the 2h expiry rather than waiting on wall-clock time.
    await runInDurableObject(stub, async (_instance, state) => {
      const room = await state.storage.get('room');
      room.createdAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      await state.storage.put('room', room);
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const stillThere = await runInDurableObject(stub, (_instance, state) =>
      state.storage.get('room'),
    );
    expect(stillThere).toBeUndefined();

    // The code is free again — a new /init succeeds.
    const res = await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify(baseInitBody(topic.id)),
    });
    expect(res.status).toBe(200);
  });
});
