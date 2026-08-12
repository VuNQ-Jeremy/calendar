import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import type { GameProps } from './game-utils.js';
import { buildStressQuestions, type StressQuestion } from '../../shared/logic/flashcards';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn } = DS;

/**
 * Trọng âm — the VN exam format, in two shapes. `odd`: four words, three share a stress
 * position, pick the one that differs. `syllable`: one word, pick which syllable is stressed. The
 * IPA transcription is never shown before an answer is picked — it IS the answer — but is
 * revealed afterward alongside the audio, so a wrong guess still teaches the right sound.
 */

type Question = StressQuestion<FlashcardWordRow>;

export function StressGame({
  words,
  roundSize,
  onExit,
  onFinish,
  garden,
}: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [questions, setQuestions] = React.useState<Question[]>(() =>
    buildStressQuestions(words, roundSize),
  );
  const [idx, setIdx] = React.useState(0);
  const [picked, setPicked] = React.useState<string | number | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const done = questions.length > 0 && idx >= questions.length;
  const score = answers.filter((a) => a.correct).length;

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({
        mode: 'stress',
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
    setPicked(null);
    setIdx((i) => i + 1);
  };

  const pickOdd = (q: Extract<Question, { kind: 'odd' }>, wordId: string) => {
    if (picked !== null) return;
    setPicked(wordId);
    const correct = wordId === q.answerId;
    setAnswers((a) => [...a, { wordId: q.answerId, correct }]);
    playWord(q.words.find((w) => w.id === q.answerId)?.word ?? '');
    timer.current = setTimeout(advance, 1400);
  };

  const pickSyllable = (q: Extract<Question, { kind: 'syllable' }>, syllable: number) => {
    if (picked !== null) return;
    setPicked(syllable);
    const correct = syllable === q.answer;
    setAnswers((a) => [...a, { wordId: q.word.id, correct }]);
    playWord(q.word.word);
    timer.current = setTimeout(advance, 1400);
  };

  const replay = () => {
    finished.current = false;
    setQuestions(buildStressQuestions(words, roundSize));
    setAnswers([]);
    setIdx(0);
    setPicked(null);
    started.current = Date.now();
  };

  if (questions.length === 0) {
    return (
      <div style={endWrap}>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_stress_none')}</div>
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

  const q = questions[idx];

  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </div>

      {q.kind === 'odd' ? (
        <>
          <div style={{ color: 'var(--text-muted)' }}>{t('fc_stress_odd')}</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              width: 'min(90vw, 520px)',
            }}
          >
            {q.words.map((w) => {
              let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
              if (picked !== null) {
                if (w.id === q.answerId) variant = 'primary';
                else if (w.id === picked) variant = 'danger';
              }
              return (
                <FBtn key={w.id} variant={variant} block={true} onClick={() => pickOdd(q, w.id)}>
                  {w.word}
                </FBtn>
              );
            })}
          </div>
          {picked !== null && (
            <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
              {q.words.find((w) => w.id === q.answerId)?.ipa}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{q.word.word}</div>
          <div style={{ color: 'var(--text-muted)' }}>{t('fc_stress_syllable')}</div>
          <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {Array.from({ length: q.syllables }, (_, i) => {
              let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
              if (picked !== null) {
                if (i === q.answer) variant = 'primary';
                else if (i === picked) variant = 'danger';
              }
              return (
                <FBtn key={i} variant={variant} onClick={() => pickSyllable(q, i)}>
                  {t('fc_syllable_n', { n: i + 1 })}
                </FBtn>
              );
            })}
          </div>
          {picked !== null && (
            <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
              {q.word.ipa}
            </div>
          )}
        </>
      )}
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
