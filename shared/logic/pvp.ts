/**
 * Vocab PvP — shared protocol, scoring and reducer logic (F33/F34).
 *
 * See docs/superpowers/specs/2026-08-25-vocab-pvp-design.md. Two independent play modes share
 * this file:
 *
 *   - Room battles: a `GameRoom` Durable Object (workers/game-room.ts) drives a join-by-code
 *     race over WebSocket. The types and `applyServerMsg` reducer here are the ONLY place a
 *     `ServerMsg` becomes UI state — both the web and mobile battle screens import the same
 *     reducer, so they cannot drift.
 *   - Tabletop face-off: a same-device 1v1 duel with no networking at all (`newFaceoff` /
 *     `faceoffAnswer`).
 *
 * Answers never ride the wire until the reveal: `WireQuizQuestion` carries the options but not
 * the answer, because the wire format is visible in a browser's devtools and a client that knew
 * the answer ahead of time could not be trusted to play fair. The DO alone holds the answer.
 */

import { imageOf, type QuizQuestion } from './flashcards';

export type PvpPlayerKind = 'staff' | 'student';
export type PvpPlayer = { id: string; kind: PvpPlayerKind; name: string };
export type PvpStanding = { id: string; name: string; score: number; correct: number };

export type WireQuizQuestion = {
  wordId: string;
  prompt: 'text' | 'audio' | 'image';
  /** The word to show (text) or speak via TTS (audio); '' for image prompts. */
  promptText: string;
  /** Origin-relative `/flashcard-images/...` path; image prompts only. */
  imagePath: string | null;
  options: string[];
};

export type RoomConfig = {
  topicId: string;
  topicName: string;
  slug: string;
  mode: 'quiz';
  secondsPerQuestion: number;
  totalQuestions: number;
};

export type ClientMsg = { type: 'start' } | { type: 'answer'; index: number; option: string };

export type ServerMsg =
  | { type: 'lobby'; code: string; config: RoomConfig; players: PvpPlayer[]; hostId: string }
  | {
      type: 'question';
      index: number;
      total: number;
      deadline: number;
      question: WireQuizQuestion;
    }
  | {
      type: 'reveal';
      index: number;
      answer: string;
      correctIds: string[];
      standings: PvpStanding[];
    }
  | { type: 'finish'; standings: PvpStanding[] }
  | { type: 'room-error'; code: 'not_found' | 'already_started' | 'full' | 'not_host' };

/** No I/L/O/0/1 — characters a tired teacher can misread aloud across a classroom. */
export const PVP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PVP_CODE_LENGTH = 4;
export const PVP_MAX_PLAYERS = 40;
export const PVP_DEFAULT_SECONDS = 20;
export const PVP_REVEAL_MS = 4000;
export const PVP_LADDER_WIN_POINTS = 3;
export const PVP_LADDER_PLAY_POINTS = 1;
/**
 * Farm resistance without Elo: only a student's first PVP_LADDER_DAILY_CAP matches per ICT day
 * count toward the monthly ladder. Revisit with a real rating system if farming shows up in
 * practice — this is the cheapest guard that stops a pair of students grinding the ladder by
 * replaying each other all afternoon.
 */
export const PVP_LADDER_DAILY_CAP = 10;

/** Points for a CORRECT answer: 500 base + up to 500 speed bonus. Wrong = 0 at the call site. */
export function speedPoints(msLeft: number, msTotal: number): number {
  const clamped = Math.min(Math.max(msLeft, 0), msTotal);
  return 500 + Math.round((500 * clamped) / msTotal);
}

/**
 * Split one built quiz question into what clients may see (`wire`) and the answer the DO keeps
 * to itself until the reveal.
 */
export function toWireQuiz<
  W extends {
    id: string;
    word: string;
    meaningVi: string;
    definitionEn?: string | null;
    imageKey?: string | null;
  },
>(q: QuizQuestion<W>): { wire: WireQuizQuestion; answer: string } {
  const wire: WireQuizQuestion =
    q.prompt === 'image'
      ? {
          wordId: q.word.id,
          prompt: 'image',
          promptText: '',
          imagePath: imageOf(q.word),
          options: q.options,
        }
      : {
          wordId: q.word.id,
          prompt: q.prompt,
          promptText: q.word.word,
          imagePath: null,
          options: q.options,
        };
  return { wire, answer: q.answer };
}

export type PvpView =
  | { phase: 'connecting' }
  | { phase: 'lobby'; code: string; config: RoomConfig; players: PvpPlayer[]; hostId: string }
  | {
      phase: 'question';
      index: number;
      total: number;
      deadline: number;
      question: WireQuizQuestion;
      config: RoomConfig;
      myAnswer: string | null;
    }
  | {
      phase: 'reveal';
      index: number;
      answer: string;
      correctIds: string[];
      standings: PvpStanding[];
      config: RoomConfig;
    }
  | { phase: 'finish'; standings: PvpStanding[]; config: RoomConfig }
  | { phase: 'error'; code: string };

/**
 * Pure reducer — the ONLY place a ServerMsg becomes UI state, shared by the web and mobile
 * battle screens. Unknown message types return the view unchanged (forward compatibility with
 * a server that ships a message type an older client does not know yet).
 */
export function applyServerMsg(view: PvpView, msg: ServerMsg): PvpView {
  switch (msg.type) {
    case 'lobby':
      return {
        phase: 'lobby',
        code: msg.code,
        config: msg.config,
        players: msg.players,
        hostId: msg.hostId,
      };
    case 'question': {
      const config = 'config' in view ? view.config : ({} as RoomConfig);
      return {
        phase: 'question',
        index: msg.index,
        total: msg.total,
        deadline: msg.deadline,
        question: msg.question,
        config,
        myAnswer: null,
      };
    }
    case 'reveal': {
      const config = 'config' in view ? view.config : ({} as RoomConfig);
      return {
        phase: 'reveal',
        index: msg.index,
        answer: msg.answer,
        correctIds: msg.correctIds,
        standings: msg.standings,
        config,
      };
    }
    case 'finish': {
      const config = 'config' in view ? view.config : ({} as RoomConfig);
      return { phase: 'finish', standings: msg.standings, config };
    }
    case 'room-error':
      // `not_host` is non-terminal to both transports (they deliberately do not close the socket
      // for it — the game continues) but was terminal here, so the host would get thrown off a
      // live lobby onto an error screen while their socket stayed open. Leave the view unchanged:
      // the Start button is host-only, so a legitimate client can never provoke `not_host` in the
      // first place, and ignoring a message a real client cannot cause is strictly better than
      // ejecting someone from a running lobby. Every other room-error code stays terminal.
      if (msg.code === 'not_host') return view;
      return { phase: 'error', code: msg.code };
    default:
      return view;
  }
}

export type LadderRow = {
  studentId: string;
  name: string;
  points: number;
  wins: number;
  played: number;
};

/**
 * Monthly ladder math. Farm resistance without Elo: per student per ICT day, only the first
 * PVP_LADDER_DAILY_CAP matches (chronological) count. Rank 1 -> 3 pts, else 1. Sorted points
 * desc, then wins desc, then name. Revisit with Elo if farming appears.
 */
export function ladderFromMatches(
  rows: {
    matchId: string;
    playedAtIct: string;
    studentId: string;
    name: string;
    rank: number;
  }[],
): LadderRow[] {
  const byStudent = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byStudent.get(r.studentId) ?? [];
    list.push(r);
    byStudent.set(r.studentId, list);
  }

  const out: LadderRow[] = [];
  for (const [studentId, list] of byStudent) {
    // Chronological within each day so "first N matches" is well-defined; matchId is a UUID and
    // carries no time ordering, so this relies on the caller's row order being chronological —
    // ladderFromMatches does not itself sort by time.
    const dayCounts = new Map<string, number>();
    let points = 0;
    let wins = 0;
    let played = 0;
    for (const r of list) {
      const count = dayCounts.get(r.playedAtIct) ?? 0;
      if (count >= PVP_LADDER_DAILY_CAP) continue;
      dayCounts.set(r.playedAtIct, count + 1);
      played++;
      if (r.rank === 1) {
        points += PVP_LADDER_WIN_POINTS;
        wins++;
      } else {
        points += PVP_LADDER_PLAY_POINTS;
      }
    }
    out.push({ studentId, name: list[0].name, points, wins, played });
  }

  return out.sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
}

/** The standard GameResult a client posts after a match, built from what it saw revealed. */
export function myResultFromReveals(
  reveals: { index: number; correct: boolean; wordId: string }[],
  durationMs: number,
): {
  mode: 'quiz';
  score: number;
  total: number;
  durationMs: number;
  answers: { wordId: string; correct: boolean }[];
} {
  const answers = reveals.map((r) => ({ wordId: r.wordId, correct: r.correct }));
  const score = answers.filter((a) => a.correct).length;
  return { mode: 'quiz', score, total: answers.length, durationMs, answers };
}

// ---- Tabletop face-off (same-device 1v1; see the spec's face-off decision) ----

export const FACEOFF_TARGET = 5;
/** 2*TARGET + 3: enough headroom for a 4-4 endgame without running forever. */
export const FACEOFF_MAX_QUESTIONS = 13;

export type FaceoffSide = 1 | 2;
export type FaceoffState = {
  qIndex: number;
  scores: { 1: number; 2: number };
  /** A wrong tap locks that side out until the next question (anti spam-tapping). */
  locked: { 1: boolean; 2: boolean };
  finished: boolean;
  /** Set when finished; null while running AND on a finished draw. */
  winner: FaceoffSide | null;
};

export function newFaceoff(): FaceoffState {
  return {
    qIndex: 0,
    scores: { 1: 0, 2: 0 },
    locked: { 1: false, 2: false },
    finished: false,
    winner: null,
  };
}

/**
 * Pure reducer for one tap. Ignores input when finished or when that side is already locked.
 * A correct tap scores a point and advances the question (both sides unlock); reaching
 * FACEOFF_TARGET finishes the duel with that winner. A wrong tap locks only that side; once
 * both sides are locked the question advances with no point awarded. Reaching totalQuestions
 * finishes on the higher score, with a tie producing `winner: null` (a draw).
 */
export function faceoffAnswer(
  s: FaceoffState,
  side: FaceoffSide,
  correct: boolean,
  totalQuestions: number,
): FaceoffState {
  if (s.finished || s.locked[side]) return s;

  if (correct) {
    const score = s.scores[side] + 1;
    const scores = { ...s.scores, [side]: score };
    if (score >= FACEOFF_TARGET) {
      return { ...s, scores, locked: { 1: false, 2: false }, finished: true, winner: side };
    }
    const qIndex = s.qIndex + 1;
    if (qIndex >= totalQuestions) {
      const winner = scores[1] === scores[2] ? null : scores[1] > scores[2] ? 1 : 2;
      return { qIndex, scores, locked: { 1: false, 2: false }, finished: true, winner };
    }
    return { qIndex, scores, locked: { 1: false, 2: false }, finished: false, winner: null };
  }

  const other: FaceoffSide = side === 1 ? 2 : 1;
  const locked = { ...s.locked, [side]: true };
  if (!locked[other]) {
    return { ...s, locked };
  }
  // Both sides now locked on this question: advance with no point awarded.
  const qIndex = s.qIndex + 1;
  if (qIndex >= totalQuestions) {
    const winner = s.scores[1] === s.scores[2] ? null : s.scores[1] > s.scores[2] ? 1 : 2;
    return { ...s, qIndex, locked: { 1: false, 2: false }, finished: true, winner };
  }
  return { ...s, qIndex, locked: { 1: false, 2: false } };
}

// ---- Race mode ----

/** Race mode: a preset question count, a shared countdown, independent progress. */
export const RACE_QUESTION_COUNTS = [10, 15, 20] as const;
export const RACE_DEFAULT_QUESTIONS = 10;
export const RACE_SECONDS_CHOICES = [60, 90, 120] as const;
export const RACE_DEFAULT_SECONDS = 90;
/**
 * A wrong tap costs the tapper this long, and nobody else. Without a cost, four-way
 * spam-tapping finishes a race instantly and the mode measures thumb speed, not vocabulary;
 * with a SHARED lockout it would stall the opponent, which is exactly what this mode exists
 * to avoid. A self-only cooldown is the one option that satisfies both.
 */
export const RACE_WRONG_PENALTY_MS = 1500;

export type RaceState = {
  /** Each side's own index into the SHARED question list — both face the same questions in the
   *  same order (fairness), each at their own position. */
  progress: { 1: number; 2: number };
  /** Epoch ms until which that side's taps are ignored. Self-only; see RACE_WRONG_PENALTY_MS. */
  blockedUntil: { 1: number; 2: number };
  totalQuestions: number;
  finished: boolean;
  /** Set when finished; null while running AND on a finished draw. */
  winner: FaceoffSide | null;
};

export function newRace(totalQuestions: number): RaceState {
  return {
    progress: { 1: 0, 2: 0 },
    blockedUntil: { 1: 0, 2: 0 },
    totalQuestions,
    finished: false,
    winner: null,
  };
}

/**
 * Pure reducer for one tap. Ignores input when finished or when that side is still cooling down
 * from an earlier wrong tap (own-side only — see RACE_WRONG_PENALTY_MS). A correct tap advances
 * only that side's progress; reaching totalQuestions finishes the race with that side as winner.
 * A wrong tap starts that side's cooldown and touches nothing else — no shared lock, no effect
 * on the opponent's progress or timing.
 */
export function raceAnswer(
  s: RaceState,
  side: FaceoffSide,
  correct: boolean,
  now: number,
): RaceState {
  if (s.finished || now < s.blockedUntil[side]) return s;

  if (!correct) {
    const blockedUntil = { ...s.blockedUntil, [side]: now + RACE_WRONG_PENALTY_MS };
    return { ...s, blockedUntil };
  }

  const progressed = s.progress[side] + 1;
  const progress = { ...s.progress, [side]: progressed };
  if (progressed >= s.totalQuestions) {
    return { ...s, progress, finished: true, winner: side };
  }
  return { ...s, progress };
}

/** The countdown expired: whoever got further wins, equal progress is a draw (winner null). */
export function raceTimeUp(s: RaceState): RaceState {
  if (s.finished) return s;
  const winner = s.progress[1] === s.progress[2] ? null : s.progress[1] > s.progress[2] ? 1 : 2;
  return { ...s, finished: true, winner };
}
