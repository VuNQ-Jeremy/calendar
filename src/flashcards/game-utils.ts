import type { FlashcardWordRow } from '../../server/services/flashcards.js';

export type GameMode = 'flip' | 'quiz' | 'match';

export type GameResult = {
  mode: GameMode;
  score: number;
  total: number;
  durationMs?: number;
  answers: { wordId: string; correct: boolean }[];
};

export interface GameProps {
  words: FlashcardWordRow[];
  onExit: () => void;
  onFinish: (result: GameResult) => void;
}

/** Fisher–Yates shuffle returning a new array (does not mutate the input). */
export function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
