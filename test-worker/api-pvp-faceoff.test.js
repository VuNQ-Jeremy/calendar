import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as authSvc from '../server/services/auth';
import * as flashcardsSvc from '../server/services/flashcards';
import * as peopleSvc from '../server/services/people';
import { hashPassword } from '../server/services/crypto';
import { accounts, pvpMatches, pvpMatchPlayers } from '../server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * `POST /api/pvp/faceoff` — the bearer route the mobile face-off records through.
 *
 * The interesting properties are all refusals: a student token must not be able to write a match,
 * and a self-match must be rejected before it reaches the insert. The happy path is asserted on the
 * ROWS, not the status, because a 200 with nothing written is the failure that would actually cost
 * a teacher their recorded game.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

// Lifted from test-worker/live-hub.test.js — a small duplicated helper across two independent
// test files is the house pattern here, so this is NOT refactored into a shared module.
async function seedStaffSession(email) {
  const d = db();
  const staffRow = await peopleSvc.createStaff(d, {
    name: 'Faceoff Staff',
    email,
    role: 'Teacher',
    color: 'orange',
  });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword('pw'),
    staffId: staffRow.id,
    createdAt: new Date().toISOString(),
  });
  return authSvc.createSession(d.raw, accountId, false);
}

/** Same shape as seedStaffSession, but the account hangs off a student row instead of staff. */
async function seedStudentSession(email) {
  const d = db();
  const studentRow = await peopleSvc.createStudent(d, { name: 'Faceoff Student', color: 'blue' });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword('pw'),
    studentId: studentRow.id,
    createdAt: new Date().toISOString(),
  });
  return authSvc.createSession(d.raw, accountId, false);
}

const post = (token, body) =>
  SELF.fetch('https://example.com/api/pvp/faceoff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/pvp/faceoff', () => {
  it('records a duel and rejects the refusals', async () => {
    const d = db();
    const topic = await flashcardsSvc.createTopicWithWords(
      d,
      { name: `Faceoff API ${crypto.randomUUID()}`, description: null, color: 'orange' },
      [{ word: 'cat', meaningVi: 'con mèo' }],
    );
    const a = await peopleSvc.createStudent(d, { name: 'Faceoff A', color: 'green' });
    const b = await peopleSvc.createStudent(d, { name: 'Faceoff B', color: 'blue' });

    // Seed a staff session the same way test-worker/live-hub.test.js does, and a student one.
    const staffToken = await seedStaffSession('faceoff-api-staff@test.com');
    const studentToken = await seedStudentSession('faceoff-api-student@test.com');

    const payload = {
      mode: 'quiz-faceoff',
      topicId: topic.id,
      winnerStudentId: a.id,
      loserStudentId: b.id,
      winnerScore: 5,
      loserScore: 3,
      total: 8,
    };

    // A student device must never write a match.
    expect((await post(studentToken, payload)).status).toBe(403);

    // Winner and loser cannot be the same person.
    const same = await post(staffToken, { ...payload, loserStudentId: a.id });
    expect(same.status).toBe(422);

    // Staff: recorded, and the ROWS are what proves it.
    expect((await post(staffToken, payload)).status).toBe(200);
    const rawDb = createRawDb(env);
    const matches = await rawDb.select().from(pvpMatches).where(eq(pvpMatches.topicId, topic.id));
    expect(matches).toHaveLength(1);
    expect(matches[0].mode).toBe('quiz-faceoff');
    expect(matches[0].code).toBe('1V1');
    const players = await rawDb
      .select()
      .from(pvpMatchPlayers)
      .where(eq(pvpMatchPlayers.matchId, matches[0].id));
    expect(players.find((p) => p.rank === 1).studentId).toBe(a.id);
    expect(players.find((p) => p.rank === 2).studentId).toBe(b.id);
  });

  it('refuses an unknown mode before the insert', async () => {
    const staffToken = await seedStaffSession('faceoff-api-mode@test.com');
    const res = await post(staffToken, {
      mode: 'quiz-nonsense',
      topicId: 'x',
      winnerStudentId: 'a',
      loserStudentId: 'b',
      winnerScore: 1,
      loserScore: 0,
      total: 1,
    });
    expect(res.status).toBe(422);
  });
});
