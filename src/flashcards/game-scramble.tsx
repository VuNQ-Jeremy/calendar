import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import { meaningOf } from './game-utils.js';
import type { GameProps } from './game-utils.js';
import {
  letterSlots,
  pickRound,
  scrambleLetters,
  SPELL_ROUND_SIZE,
} from '../../shared/logic/flashcards';
import type { LetterSlot } from '../../shared/logic/flashcards';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn } = DS;

/**
 * Xếp chữ — the word's letters shuffled into a bank, the Vietnamese meaning as the hint. Tapping
 * a bank tile drops it into the next empty slot; tapping a placed tile sends it back. The answer
 * grades itself the moment the last slot fills: string equality against the word, so any
 * arrangement of duplicate letters that spells it is right.
 *
 * Spaces and hyphens are fixed separators rendered in place (`letterSlots`) — only letters play.
 * One graded attempt per word: wrong shows the correct spelling briefly, then moves on.
 */

type Question = { word: FlashcardWordRow; slots: LetterSlot[]; bank: string[] };

function buildQuestions(words: FlashcardWordRow[], roundSize?: number): Question[] {
  return pickRound(words, roundSize ?? SPELL_ROUND_SIZE).map((w) => ({
    word: w,
    slots: letterSlots(w.word),
    bank: scrambleLetters(w.word),
  }));
}

export function ScrambleGame({
  words,
  roundSize,
  onExit,
  onFinish,
  garden,
}: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [questions, setQuestions] = React.useState<Question[]>(() =>
    buildQuestions(words, roundSize),
  );
  const [idx, setIdx] = React.useState(0);
  // For each letter slot (in order), the index of the bank tile sitting in it, or null.
  const [placed, setPlaced] = React.useState<(number | null)[]>(() =>
    Array(questions[0]?.bank.length ?? 0).fill(null),
  );
  const [verdict, setVerdict] = React.useState<'correct' | 'wrong' | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const done = idx >= questions.length;
  const score = answers.filter((a) => a.correct).length;
  const q = questions[idx];

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({
        mode: 'scramble',
        score,
        total: questions.length,
        durationMs: Date.now() - started.current,
        answers,
      });
    }
  }, [done, score, questions.length, answers, onFinish]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const advance = () => {
    setVerdict(null);
    setPlaced(Array(questions[idx + 1]?.bank.length ?? 0).fill(null));
    setIdx((i) => i + 1);
  };

  // The last slot just filled: grade, flash, move on. Grading is string equality against the
  // word's letters in order, so "apple" built from either p is correct.
  const grade = (next: (number | null)[]) => {
    const built = next.map((i) => (i === null ? '' : q.bank[i])).join('');
    const wanted = q.slots
      .filter((s) => s.letter)
      .map((s) => s.ch)
      .join('');
    const correct = built.toLowerCase() === wanted.toLowerCase();
    setVerdict(correct ? 'correct' : 'wrong');
    setAnswers((a) => [...a, { wordId: q.word.id, correct }]);
    timer.current = setTimeout(advance, correct ? 700 : 1600);
  };

  const tapBank = (bankIdx: number) => {
    if (verdict || placed.includes(bankIdx)) return;
    const at = placed.indexOf(null);
    if (at < 0) return;
    const next = placed.slice();
    next[at] = bankIdx;
    setPlaced(next);
    if (!next.includes(null)) grade(next);
  };

  const tapSlot = (slotOrdinal: number) => {
    if (verdict) return;
    setPlaced((p) => {
      const next = p.slice();
      next[slotOrdinal] = null;
      return next;
    });
  };

  const clear = () => {
    if (!verdict) setPlaced(Array(q.bank.length).fill(null));
  };

  const replay = () => {
    finished.current = false;
    const qs = buildQuestions(words, roundSize);
    setQuestions(qs);
    setAnswers([]);
    setIdx(0);
    setPlaced(Array(qs[0]?.bank.length ?? 0).fill(null));
    setVerdict(null);
    started.current = Date.now();
  };

  if (done) {
    return (
      <div style={endWrap}>
        <div style={{ fontSize: 'var(--text-xl, 28px)', fontWeight: 800 }}>
          {t('fc_round_done')}
        </div>
        <div style={{ fontSize: 'var(--text-lg, 22px)', color: 'var(--text-strong)' }}>
          {t('fc_score')}: {score}/{questions.length}
        </div>
        <RoundGardenNote garden={garden} />
        <div className="m-row" style={{ gap: 10 }}>
          <FBtn variant="primary" onClick={replay}>
            {t('fc_play_again')}
          </FBtn>
          <FBtn variant="secondary" onClick={onExit}>
            {t('fc_exit')}
          </FBtn>
        </div>
      </div>
    );
  }

  // Walk the slot row, numbering letter slots so taps map back to `placed`.
  let ordinal = -1;
  const used = new Set(placed.filter((v): v is number => v !== null));

  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 'var(--text-lg, 24px)', fontWeight: 800, textAlign: 'center' }}>
          {meaningOf(q.word)}
        </div>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_scramble_hint')}</div>
      </div>

      <div className="m-row" style={slotRow} data-testid="scramble-slots">
        {q.slots.map((s, i) => {
          if (!s.letter) {
            return (
              <span key={i} style={{ ...tileBase, border: 'none', background: 'transparent' }}>
                {s.ch}
              </span>
            );
          }
          ordinal += 1;
          const at = ordinal;
          const bankIdx = placed[at];
          return (
            <button
              key={i}
              type="button"
              data-slot={at}
              onClick={() => tapSlot(at)}
              style={{
                ...tileBase,
                ...slotStyle,
                ...(verdict === 'correct' ? tileRight : verdict === 'wrong' ? tileWrong : null),
              }}
            >
              {bankIdx === null ? '' : q.bank[bankIdx]}
            </button>
          );
        })}
      </div>

      {verdict === 'wrong' && (
        <div style={{ color: 'var(--text-strong)', fontWeight: 700 }}>
          {t('fc_correct_was', { word: q.word.word })}
        </div>
      )}

      <div className="m-row" style={{ ...slotRow, maxWidth: 520 }} data-testid="scramble-bank">
        {q.bank.map((ch, i) => (
          <button
            key={i}
            type="button"
            data-tile={ch}
            disabled={used.has(i) || verdict !== null}
            onClick={() => tapBank(i)}
            style={{ ...tileBase, ...bankStyle, opacity: used.has(i) ? 0.25 : 1 }}
          >
            {ch}
          </button>
        ))}
      </div>

      <FBtn variant="ghost" onClick={clear}>
        {t('fc_clear')}
      </FBtn>
    </div>
  );
}

const playWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 24,
  padding: 24,
};

const endWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  padding: 24,
};

const slotRow: React.CSSProperties = {
  gap: 6,
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'center',
};

const tileBase: React.CSSProperties = {
  minWidth: 38,
  height: 44,
  padding: '0 6px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--text-md, 18px)',
  fontWeight: 700,
  color: 'var(--text-strong)',
  borderRadius: 10,
  cursor: 'pointer',
};

const slotStyle: React.CSSProperties = {
  border: '2px dashed var(--line, #e7e0d6)',
  background: 'var(--bg-card, #fff)',
};

const bankStyle: React.CSSProperties = {
  border: '1px solid var(--line, #e7e0d6)',
  background: 'var(--bg-card, #fff)',
  boxShadow: '0 1px 2px rgba(0,0,0,.06)',
};

const tileRight: React.CSSProperties = {
  border: '2px solid var(--green-600, #2e7d32)',
  background: 'var(--green-50, #e8f5e9)',
};

const tileWrong: React.CSSProperties = {
  border: '2px solid var(--red-600, #c0392b)',
  background: 'var(--red-50, #fdecea)',
};
