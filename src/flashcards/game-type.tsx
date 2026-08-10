import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import { meaningOf } from './game-utils.js';
import type { GameProps } from './game-utils.js';
import { checkTyped, pickRound, typeEligible } from '../../shared/logic/flashcards';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn } = DS;

/**
 * Gõ tiếng Anh — the Vietnamese meaning as the prompt, the English word typed from memory. Graded
 * by `checkTyped` (case-, whitespace- and diacritic-insensitive: the school's rules), one attempt
 * per word; a miss shows the correct spelling and plays its audio before moving on.
 *
 * Words whose meaning falls back to the word itself (`typeEligible`) are skipped — they would
 * print the answer as the hint. A deck with no eligible word renders a "nothing to play" panel
 * rather than posting a zero-question result, which the server would reject (total >= 1).
 */

export function TypeGame({ words, onExit, onFinish, garden }: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [round, setRound] = React.useState<FlashcardWordRow[]>(() =>
    pickRound(words.filter(typeEligible)),
  );
  const [idx, setIdx] = React.useState(0);
  const [input, setInput] = React.useState('');
  const [verdict, setVerdict] = React.useState<'correct' | 'wrong' | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const done = round.length > 0 && idx >= round.length;
  const score = answers.filter((a) => a.correct).length;
  const w = round[idx];

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({
        mode: 'type',
        score,
        total: round.length,
        durationMs: Date.now() - started.current,
        answers,
      });
    }
  }, [done, score, round.length, answers, onFinish]);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Refocus for the next word — the reveal disables the input, which drops focus.
  React.useEffect(() => {
    if (!verdict && !done) inputRef.current?.focus();
  }, [verdict, done, idx]);

  const submit = () => {
    if (verdict || !input.trim() || !w) return;
    const correct = checkTyped(input, w.word);
    setVerdict(correct ? 'correct' : 'wrong');
    setAnswers((a) => [...a, { wordId: w.id, correct }]);
    if (!correct) playWord(w.word);
    timer.current = setTimeout(
      () => {
        setVerdict(null);
        setInput('');
        setIdx((i) => i + 1);
      },
      correct ? 700 : 1800,
    );
  };

  const replay = () => {
    finished.current = false;
    setRound(pickRound(words.filter(typeEligible)));
    setAnswers([]);
    setIdx(0);
    setInput('');
    setVerdict(null);
    started.current = Date.now();
  };

  // Every word's meaning IS the word (imported without translations): nothing askable.
  if (round.length === 0) {
    return (
      <div style={endWrap}>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_no_words')}</div>
        <FBtn variant="secondary" onClick={onExit}>
          {t('fc_exit')}
        </FBtn>
      </div>
    );
  }

  if (done) {
    return (
      <div style={endWrap}>
        <div style={{ fontSize: 'var(--text-xl, 28px)', fontWeight: 800 }}>
          {t('fc_round_done')}
        </div>
        <div style={{ fontSize: 'var(--text-lg, 22px)', color: 'var(--text-strong)' }}>
          {t('fc_score')}: {score}/{round.length}
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

  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: idx + 1, n: round.length })} · {t('fc_score')}: {score}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 'var(--text-xl, 28px)', fontWeight: 800, textAlign: 'center' }}>
          {meaningOf(w)}
        </div>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_type_prompt')}</div>
      </div>

      <div className="m-stack" style={{ gap: 10, width: 'min(90vw, 420px)' }}>
        <input
          ref={inputRef}
          className="mochi-input"
          autoFocus={true}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('fc_type_placeholder')}
          disabled={verdict !== null}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          style={{
            textAlign: 'center',
            fontSize: 'var(--text-md, 18px)',
            fontWeight: 700,
            ...(verdict === 'correct'
              ? { borderColor: 'var(--green-600, #2e7d32)' }
              : verdict === 'wrong'
                ? { borderColor: 'var(--red-600, #c0392b)' }
                : null),
          }}
        />
        {verdict === 'wrong' ? (
          <div style={{ color: 'var(--text-strong)', fontWeight: 700, textAlign: 'center' }}>
            {t('fc_correct_was', { word: w.word })}
          </div>
        ) : (
          <FBtn variant="primary" block={true} disabled={!input.trim() || !!verdict} onClick={submit}>
            {t('fc_check')}
          </FBtn>
        )}
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
