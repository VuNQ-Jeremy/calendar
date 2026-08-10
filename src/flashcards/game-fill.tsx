import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import { meaningOf, shuffle } from './game-utils.js';
import type { GameProps } from './game-utils.js';
import { decoyLetters, maskWord, pickRound } from '../../shared/logic/flashcards';
import type { MaskSlot } from '../../shared/logic/flashcards';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn } = DS;

/**
 * Điền chữ cái — the word with 40% of its letters hidden (`maskWord`), the Vietnamese meaning as
 * the hint. The bank holds the hidden letters plus two decoys, shuffled; tapping fills the next
 * gap, tapping a filled gap empties it. Grades itself when the last gap fills — string equality
 * against the word, so decoys can never make a wrong fill "correct".
 *
 * Explicitly NOT sentence gap-fill: there are no example sentences anywhere in this feature.
 */

type Question = { word: FlashcardWordRow; slots: MaskSlot[]; bank: string[] };

function buildQuestions(words: FlashcardWordRow[]): Question[] {
  return pickRound(words).map((w) => {
    const slots = maskWord(w.word);
    const hidden = slots.filter((s) => s.hidden).map((s) => s.ch);
    return { word: w, slots, bank: shuffle([...hidden, ...decoyLetters(2)]) };
  });
}

export function FillGame({ words, onExit, onFinish, garden }: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [questions, setQuestions] = React.useState<Question[]>(() => buildQuestions(words));
  const [idx, setIdx] = React.useState(0);
  // For each gap (in order), the bank index filling it, or null.
  const gapCount = (q: Question | undefined) => q?.slots.filter((s) => s.hidden).length ?? 0;
  const [placed, setPlaced] = React.useState<(number | null)[]>(() =>
    Array(gapCount(questions[0])).fill(null),
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
        mode: 'fill',
        score,
        total: questions.length,
        durationMs: Date.now() - started.current,
        answers,
      });
    }
  }, [done, score, questions.length, answers, onFinish]);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const advance = () => {
    setVerdict(null);
    setPlaced(Array(gapCount(questions[idx + 1])).fill(null));
    setIdx((i) => i + 1);
  };

  const grade = (next: (number | null)[]) => {
    let gap = -1;
    const built = q.slots
      .map((s) => {
        if (!s.hidden) return s.ch;
        gap += 1;
        const bankIdx = next[gap];
        return bankIdx === null ? '' : q.bank[bankIdx];
      })
      .join('');
    const correct = built.toLowerCase() === q.word.word.toLowerCase();
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

  const tapGap = (gapOrdinal: number) => {
    if (verdict) return;
    setPlaced((p) => {
      const next = p.slice();
      next[gapOrdinal] = null;
      return next;
    });
  };

  const replay = () => {
    finished.current = false;
    const qs = buildQuestions(words);
    setQuestions(qs);
    setAnswers([]);
    setIdx(0);
    setPlaced(Array(gapCount(qs[0])).fill(null));
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

  let gapOrdinal = -1;
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
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_fill_hint')}</div>
      </div>

      <div className="m-row" style={slotRow} data-testid="fill-slots">
        {q.slots.map((s, i) => {
          if (!s.hidden) {
            return (
              <span
                key={i}
                style={{
                  ...tileBase,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'default',
                  minWidth: s.ch === ' ' ? 16 : undefined,
                }}
              >
                {s.ch}
              </span>
            );
          }
          gapOrdinal += 1;
          const at = gapOrdinal;
          const bankIdx = placed[at];
          return (
            <button
              key={i}
              type="button"
              data-slot={at}
              onClick={() => tapGap(at)}
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

      <div className="m-row" style={{ ...slotRow, maxWidth: 520 }} data-testid="fill-bank">
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
