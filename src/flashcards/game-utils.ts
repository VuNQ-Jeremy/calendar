import type { FlashcardWordRow } from '../../server/services/flashcards.js';
import {
  MIN_WORDS,
  fmtDuration,
  flashcardImagePath,
  meaningOf,
  parseImportLines,
  shuffle,
  type GameMode,
} from '../../shared/logic/flashcards';

/**
 * The web half of the game helpers.
 *
 * The pure logic — `meaningOf`, `shuffle`, `fmtDuration`, `parseImportLines`, `MIN_WORDS` — moved
 * to shared/logic/flashcards.ts in phase 3 so the mobile app runs the identical implementations.
 * These re-exports keep this module's original surface intact; nothing that imports from here
 * had to change.
 */
export { MIN_WORDS, fmtDuration, flashcardImagePath, meaningOf, parseImportLines, shuffle };
export type { GameMode };

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
