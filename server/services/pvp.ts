import { and, eq, gte, lt } from 'drizzle-orm';
import { pvpMatches, pvpMatchPlayers, students } from '../db/schema';
import type { TenantDb } from '../db';
import { fail } from '../api/handler';
import * as flashcardsSvc from './flashcards';
import { buildQuizQuestions, DEFAULT_ROUND_SIZE, MIN_WORDS } from '../../shared/logic/flashcards';
import { ictDateOf } from '../../shared/logic/tests';
import {
  ladderFromMatches,
  PVP_CODE_ALPHABET,
  PVP_CODE_LENGTH,
  toWireQuiz,
  type LadderRow,
  type PvpPlayer,
  type RoomConfig,
} from '../../shared/logic/pvp';
import type { FaceoffResultInput, PvpRoomInput } from '../../shared/schemas';

/** A cryptographically random room code from the no-lookalike-characters alphabet. */
function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(PVP_CODE_LENGTH));
  let out = '';
  for (const b of bytes) out += PVP_CODE_ALPHABET[b % PVP_CODE_ALPHABET.length];
  return out;
}

/**
 * Build a room's question set and initialize its `GameRoom` Durable Object. Returns the code
 * players join with.
 *
 * The DO instance is keyed `t:<tenantId>:<code>` — the same tenant-fencing shape as LiveHub —
 * so the code space is per-school, never global, and a cross-school collision cannot happen.
 */
export async function createRoom(
  db: TenantDb,
  env: Env,
  user: { tenantId: string; kind: 'staff' | 'student'; user: { id: string; name: string } },
  input: PvpRoomInput,
): Promise<{ code: string }> {
  const topic = await flashcardsSvc.getTopicBySlug(db, input.slug);
  if (!topic) throw fail('not_found', 404);

  const words = await flashcardsSvc.listWords(db, topic.id);
  if (words.length < MIN_WORDS.quiz) throw fail('too_few_words', 422);

  const questions = buildQuizQuestions(words, input.roundSize ?? DEFAULT_ROUND_SIZE).map(
    toWireQuiz,
  );
  const config: RoomConfig = {
    topicId: topic.id,
    topicName: topic.name,
    slug: topic.slug ?? topic.id,
    mode: 'quiz',
    secondsPerQuestion: input.secondsPerQuestion ?? 20,
    totalQuestions: questions.length,
  };
  const host: PvpPlayer = { id: user.user.id, kind: user.kind, name: user.user.name };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(`t:${user.tenantId}:${code}`));
    const res = await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      body: JSON.stringify({ code, tenantId: user.tenantId, config, questions, host }),
    });
    if (res.ok) return { code };
    if (res.status !== 409) throw fail('room_init_failed', 502);
  }
  throw fail('room_conflict', 503);
}

/** One finished tabletop duel -> one ladder-visible match. Draws are never posted. */
export async function recordFaceoffMatch(db: TenantDb, input: FaceoffResultInput): Promise<void> {
  if (input.winnerStudentId === input.loserStudentId) throw fail('same_player', 422);
  const matchId = crypto.randomUUID();
  await db.insert(pvpMatches).values({
    id: matchId,
    // No room ever existed for a same-device duel; the column is NOT NULL and this marks the
    // match's origin for anyone reading the raw table.
    code: '1V1',
    topicId: input.topicId,
    mode: 'quiz-faceoff',
    playedAt: new Date().toISOString(),
  });
  await db.raw.insert(pvpMatchPlayers).values([
    {
      matchId,
      studentId: input.winnerStudentId,
      staffId: null,
      rank: 1,
      score: input.winnerScore,
      correct: input.winnerScore,
      total: input.total,
    },
    {
      matchId,
      studentId: input.loserStudentId,
      staffId: null,
      rank: 2,
      score: input.loserScore,
      correct: input.loserScore,
      total: input.total,
    },
  ]);
}

/**
 * The PvP ladder for one ICT calendar month ('YYYY-MM'). Staff play but never rank — only rows
 * with a `student_id` count. The SQL range is deliberately ±1 day loose (UTC storage vs. an ICT
 * boundary); `ictDateOf` in JS is what gives each row its exact day for the daily cap.
 */
export async function monthLadder(db: TenantDb, month: string): Promise<LadderRow[]> {
  const [y, m] = month.split('-').map(Number);
  const rangeStart = new Date(Date.UTC(y, m - 1, 1) - 24 * 60 * 60 * 1000).toISOString();
  const rangeEnd = new Date(Date.UTC(y, m, 1) + 24 * 60 * 60 * 1000).toISOString();

  const rows = await db.raw
    .select({
      matchId: pvpMatches.id,
      playedAt: pvpMatches.playedAt,
      studentId: pvpMatchPlayers.studentId,
      name: students.name,
      rank: pvpMatchPlayers.rank,
    })
    .from(pvpMatches)
    .innerJoin(pvpMatchPlayers, eq(pvpMatchPlayers.matchId, pvpMatches.id))
    .innerJoin(students, eq(students.id, pvpMatchPlayers.studentId))
    .where(
      db.own(
        pvpMatches,
        and(gte(pvpMatches.playedAt, rangeStart), lt(pvpMatches.playedAt, rangeEnd)),
      ),
    );

  const inMonth = rows
    .map((r) => ({ ...r, playedAtIct: ictDateOf(r.playedAt) }))
    .filter((r) => r.playedAtIct.startsWith(month))
    .filter((r): r is typeof r & { studentId: string } => r.studentId !== null);

  return ladderFromMatches(inMonth);
}

/** The current ICT month ('YYYY-MM'), for the ladder's default window. */
export function currentIctMonth(): string {
  return ictDateOf(new Date().toISOString()).slice(0, 7);
}
