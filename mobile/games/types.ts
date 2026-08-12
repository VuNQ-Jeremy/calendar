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
  /** Questions/items this round (from the round-size picker). Flip ignores it. */
  roundSize?: number;
  onExit: () => void;
  /**
   * Called exactly once, when the round completes. The play route queues it in the outbox — it
   * does NOT wait for the network, so this fires the same whether the phone is online or not.
   */
  onFinish: (result: GameResult) => void;
  /**
   * Extra content for the round-complete panel, between the score and the buttons. The play route
   * uses it for the garden verdict, which arrives after `onFinish` — hence a node the host owns
   * rather than a field on `GameResult`.
   */
  endNote?: React.ReactNode;
}
