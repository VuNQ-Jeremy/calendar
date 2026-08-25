import { describe, expect, it } from 'vitest';
import {
  applyServerMsg,
  faceoffAnswer,
  FACEOFF_TARGET,
  ladderFromMatches,
  myResultFromReveals,
  newFaceoff,
  newRace,
  raceAnswer,
  RACE_WRONG_PENALTY_MS,
  raceTimeUp,
  speedPoints,
  toWireQuiz,
  type PvpView,
} from '../shared/logic/pvp';
import type { QuizQuestion } from '../shared/logic/flashcards';

describe('speedPoints', () => {
  it('gives the full 1000 at zero time elapsed', () => {
    expect(speedPoints(20000, 20000)).toBe(1000);
  });

  it('gives the 500 base with no time left', () => {
    expect(speedPoints(0, 20000)).toBe(500);
  });

  it('clamps a negative msLeft to the base', () => {
    expect(speedPoints(-5, 20000)).toBe(500);
  });
});

describe('toWireQuiz', () => {
  const word = { id: 'w1', word: 'cat', meaningVi: 'con mèo', imageKey: null };

  it('strips the answer from the wire object for a text question', () => {
    const q: QuizQuestion<typeof word> = {
      word,
      prompt: 'text',
      options: ['con mèo', 'con chó', 'con gà', 'con vịt'],
      answer: 'con mèo',
    };
    const { wire, answer } = toWireQuiz(q);
    expect(wire).not.toHaveProperty('answer');
    expect(wire.promptText).toBe('cat');
    expect(wire.imagePath).toBeNull();
    expect(answer).toBe('con mèo');
  });

  it('maps an image prompt to imagePath via imageOf', () => {
    const imgWord = { id: 'w2', word: 'dog', meaningVi: 'con chó', imageKey: 'flashcards/x.jpg' };
    const q: QuizQuestion<typeof imgWord> = {
      word: imgWord,
      prompt: 'image',
      options: ['dog', 'cat', 'bird', 'fish'],
      answer: 'dog',
    };
    const { wire } = toWireQuiz(q);
    expect(wire.promptText).toBe('');
    expect(wire.imagePath).toBe('/flashcard-images/x.jpg');
  });
});

describe('applyServerMsg', () => {
  it('walks lobby -> question -> reveal -> question -> finish', () => {
    let view: PvpView = { phase: 'connecting' };
    const config = {
      topicId: 't1',
      topicName: 'Animals',
      slug: 'animals',
      mode: 'quiz' as const,
      secondsPerQuestion: 20,
      totalQuestions: 2,
    };
    view = applyServerMsg(view, {
      type: 'lobby',
      code: 'QZ4X',
      config,
      players: [{ id: 'u1', kind: 'staff', name: 'Teacher' }],
      hostId: 'u1',
    });
    expect(view.phase).toBe('lobby');

    const q1Question = {
      wordId: 'w1',
      prompt: 'text' as const,
      promptText: 'cat',
      imagePath: null,
      options: ['a'],
    };
    view = applyServerMsg(view, {
      type: 'question',
      index: 0,
      total: 2,
      deadline: 1000,
      question: q1Question,
    });
    expect(view.phase).toBe('question');
    if (view.phase === 'question') {
      expect(view.myAnswer).toBeNull();
      expect(view.config).toEqual(config);
    }

    view = applyServerMsg(view, {
      type: 'reveal',
      index: 0,
      answer: 'con mèo',
      correctIds: ['u1'],
      standings: [{ id: 'u1', name: 'Teacher', score: 500, correct: 1 }],
    });
    expect(view.phase).toBe('reveal');

    const q2Question = {
      wordId: 'w2',
      prompt: 'text' as const,
      promptText: 'dog',
      imagePath: null,
      options: ['b'],
    };
    view = applyServerMsg(view, {
      type: 'question',
      index: 1,
      total: 2,
      deadline: 2000,
      question: q2Question,
    });
    expect(view.phase).toBe('question');
    if (view.phase === 'question') expect(view.myAnswer).toBeNull();

    view = applyServerMsg(view, {
      type: 'finish',
      standings: [{ id: 'u1', name: 'Teacher', score: 1500, correct: 2 }],
    });
    expect(view.phase).toBe('finish');
  });

  it('returns the view unchanged for an unknown message type', () => {
    const view: PvpView = { phase: 'connecting' };
    // @ts-expect-error deliberately malformed for the forward-compat test
    const next = applyServerMsg(view, { type: 'unknown-future-message' });
    expect(next).toBe(view);
  });
});

describe('ladderFromMatches', () => {
  it('awards 3 points to rank 1 and 1 to everyone else', () => {
    const rows = [
      { matchId: 'm1', playedAtIct: '2026-08-25', studentId: 's1', name: 'Minh', rank: 1 },
      { matchId: 'm1', playedAtIct: '2026-08-25', studentId: 's2', name: 'Vy', rank: 2 },
    ];
    const ladder = ladderFromMatches(rows);
    expect(ladder.find((r) => r.studentId === 's1')).toMatchObject({
      points: 3,
      wins: 1,
      played: 1,
    });
    expect(ladder.find((r) => r.studentId === 's2')).toMatchObject({
      points: 1,
      wins: 0,
      played: 1,
    });
  });

  it('caps a student at PVP_LADDER_DAILY_CAP matches per ICT day', () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      matchId: `m${i}`,
      playedAtIct: '2026-08-25',
      studentId: 's1',
      name: 'Minh',
      rank: 1,
    }));
    const [row] = ladderFromMatches(rows);
    expect(row.played).toBe(10);
    expect(row.points).toBe(30);
  });

  it('sorts by points descending', () => {
    const rows = [
      { matchId: 'm1', playedAtIct: '2026-08-25', studentId: 's1', name: 'Minh', rank: 2 },
      { matchId: 'm1', playedAtIct: '2026-08-25', studentId: 's2', name: 'Vy', rank: 1 },
    ];
    const ladder = ladderFromMatches(rows);
    expect(ladder.map((r) => r.studentId)).toEqual(['s2', 's1']);
  });
});

describe('myResultFromReveals', () => {
  it('builds a standard GameResult from reveal correctness', () => {
    const result = myResultFromReveals(
      [
        { index: 0, correct: true, wordId: 'w1' },
        { index: 1, correct: false, wordId: 'w2' },
      ],
      30000,
    );
    expect(result).toEqual({
      mode: 'quiz',
      score: 1,
      total: 2,
      durationMs: 30000,
      answers: [
        { wordId: 'w1', correct: true },
        { wordId: 'w2', correct: false },
      ],
    });
  });
});

describe('faceoffAnswer', () => {
  it('advances qIndex and scores 1-0 on a correct answer', () => {
    const s = faceoffAnswer(newFaceoff(), 1, true, 13);
    expect(s.qIndex).toBe(1);
    expect(s.scores).toEqual({ 1: 1, 2: 0 });
    expect(s.finished).toBe(false);
  });

  it('locks only the side that answered wrong, and ignores a further tap from it', () => {
    let s = faceoffAnswer(newFaceoff(), 1, false, 13);
    expect(s.locked).toEqual({ 1: true, 2: false });
    expect(s.qIndex).toBe(0);
    const before = s;
    s = faceoffAnswer(s, 1, true, 13); // locked side taps again — ignored
    expect(s).toBe(before);
  });

  it('advances with no point when both sides answer wrong', () => {
    let s = faceoffAnswer(newFaceoff(), 1, false, 13);
    s = faceoffAnswer(s, 2, false, 13);
    expect(s.qIndex).toBe(1);
    expect(s.scores).toEqual({ 1: 0, 2: 0 });
    expect(s.locked).toEqual({ 1: false, 2: false });
  });

  it('finishes with that winner on the FACEOFF_TARGET-th point', () => {
    let s = newFaceoff();
    for (let i = 0; i < FACEOFF_TARGET; i++) s = faceoffAnswer(s, 1, true, 13);
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(1);
    expect(s.scores[1]).toBe(FACEOFF_TARGET);
  });

  it('finishes as a draw when the deck runs out tied', () => {
    // 3 questions total, tied 1-1 after both answer the last one wrong.
    let s = newFaceoff();
    s = faceoffAnswer(s, 1, true, 3); // 1-0, qIndex 1
    s = faceoffAnswer(s, 2, true, 3); // 1-1, qIndex 2
    s = faceoffAnswer(s, 1, false, 3);
    s = faceoffAnswer(s, 2, false, 3); // both wrong -> advance, qIndex 3 === total
    expect(s.finished).toBe(true);
    expect(s.winner).toBeNull();
    expect(s.scores).toEqual({ 1: 1, 2: 1 });
  });

  it('is a no-op once finished', () => {
    let s = newFaceoff();
    for (let i = 0; i < FACEOFF_TARGET; i++) s = faceoffAnswer(s, 1, true, 13);
    const finished = s;
    s = faceoffAnswer(s, 2, true, 13);
    expect(s).toBe(finished);
  });
});

describe('raceAnswer', () => {
  it('advances only the side that answered correctly', () => {
    const s = raceAnswer(newRace(10), 1, true, 1000);
    expect(s.progress).toEqual({ 1: 1, 2: 0 });
    expect(s.finished).toBe(false);
  });

  it('starts a self-only cooldown on a wrong tap and leaves the opponent free', () => {
    const s = raceAnswer(newRace(10), 1, false, 1000);
    expect(s.progress).toEqual({ 1: 0, 2: 0 });
    expect(s.blockedUntil[1]).toBe(1000 + RACE_WRONG_PENALTY_MS);
    expect(s.blockedUntil[2]).toBe(0);
    // The opponent can still score while side 1 is cooling down — the whole point of the mode.
    expect(raceAnswer(s, 2, true, 1100).progress).toEqual({ 1: 0, 2: 1 });
  });

  it('ignores a tap from a cooling-down side, and accepts it after the penalty', () => {
    const s = raceAnswer(newRace(10), 1, false, 1000);
    expect(raceAnswer(s, 1, true, 1000 + RACE_WRONG_PENALTY_MS - 1)).toBe(s);
    expect(raceAnswer(s, 1, true, 1000 + RACE_WRONG_PENALTY_MS).progress[1]).toBe(1);
  });

  it('finishes with that side as winner on the last question', () => {
    let s = newRace(3);
    for (let i = 0; i < 3; i++) s = raceAnswer(s, 2, true, 1000 + i);
    expect(s).toMatchObject({ finished: true, winner: 2 });
    expect(s.progress[2]).toBe(3);
  });

  it('is a no-op once finished', () => {
    const s = raceAnswer(newRace(1), 1, true, 1000);
    expect(raceAnswer(s, 2, true, 2000)).toBe(s);
  });
});

describe('raceTimeUp', () => {
  it('gives the win to whoever got further', () => {
    const s = raceTimeUp(raceAnswer(newRace(10), 1, true, 1000));
    expect(s).toMatchObject({ finished: true, winner: 1 });
  });

  it('calls equal progress a draw', () => {
    expect(raceTimeUp(newRace(10))).toMatchObject({ finished: true, winner: null });
  });

  it('leaves an already-finished race alone', () => {
    const s = raceAnswer(newRace(1), 1, true, 1000);
    expect(raceTimeUp(s)).toBe(s);
  });
});
