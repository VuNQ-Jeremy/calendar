import type { GameMode } from '@mochi/shared/logic/flashcards';
import type { FlashcardWordRow } from '~/lib/types';

/** Mirrors `GameResult`/`GameProps` in src/flashcards/game-utils.ts. */
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
  /**
   * Called exactly once, when the round completes. The play route queues it in the outbox — it
   * does NOT wait for the network, so this fires the same whether the phone is online or not.
   */
  onFinish: (result: GameResult) => void;
}
