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
  it('404s for an unknown code', async () => {
    const res = await connect(freshRoom(), 'u1', 'student', 'Vy');
    expect(res.status).toBe(404);
  });

  it('403s a full lobby', async () => {
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
    expect(overflow.status).toBe(403);
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
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const [q1] = (await host.waitFor(5)).slice(4);
    expect(q1.type).toBe('question');
    expect(q1.index).toBe(1);

    hostRes.webSocket.send(JSON.stringify({ type: 'answer', index: 1, option: 'a' }));
    studentRes.webSocket.send(JSON.stringify({ type: 'answer', index: 1, option: 'a' }));

    const [reveal1] = (await host.waitFor(6)).slice(5);
    expect(reveal1.type).toBe('reveal');

    // The deck is exhausted; the next alarm finishes the match instead of another question.
    expect(await runDurableObjectAlarm(stub)).toBe(true);
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
    await student.waitFor(2);

    // The student "reconnects" — a fresh socket for the same known userId.
    const rejoinRes = await connect(stub, 'student-1', 'student', 'Vy');
    expect(rejoinRes.status).toBe(101);
    const rejoin = listen(rejoinRes.webSocket);
    const [resumed] = await rejoin.waitFor(1);
    expect(resumed.type).toBe('question');
    expect(resumed.index).toBe(0);
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
