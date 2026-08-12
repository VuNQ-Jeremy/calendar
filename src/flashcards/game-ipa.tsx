import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import type { GameProps } from './game-utils.js';
import { buildIpaQuestions, type IpaQuestion } from '../../shared/logic/flashcards';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn } = DS;

/**
 * Phiên âm IPA — most questions show the transcription and ask for the word; ~35% run the other
 * way, showing the word and asking for its correct IPA (only when the deck has enough distinct
 * transcriptions to distract with). Answering plays the word's audio either way, so the round
 * reinforces the sound as well as the symbol.
 */

type Question = IpaQuestion<FlashcardWordRow>;

export function IpaGame({
  words,
  roundSize,
  onExit,
  onFinish,
  garden,
}: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [questions, setQuestions] = React.useState<Question[]>(() =>
    buildIpaQuestions(words, roundSize),
  );
  const [idx, setIdx] = React.useState(0);
  const [picked, setPicked] = React.useState<string | null>(null);
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
        mode: 'ipa',
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

  const pick = (opt: string) => {
    if (picked) return;
    const q = questions[idx];
    setPicked(opt);
    setAnswers((a) => [...a, { wordId: q.word.id, correct: opt === q.answer }]);
    playWord(q.word.word);
    timer.current = setTimeout(() => {
      setPicked(null);
      setIdx((i) => i + 1);
    }, 900);
  };

  const replay = () => {
    finished.current = false;
    setQuestions(buildIpaQuestions(words, roundSize));
    setAnswers([]);
    setIdx(0);
    setPicked(null);
    started.current = Date.now();
  };

  if (questions.length === 0) {
    return (
      <div style={endWrap}>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_ipa_none')}</div>
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
  const ipaStyle: React.CSSProperties = { fontFamily: 'var(--font-mono, monospace)' };

  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        {q.direction === 'ipa-to-word' ? (
          <>
            <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800, ...ipaStyle }}>
              {q.word.ipa}
            </div>
            <div style={{ color: 'var(--text-muted)' }}>{t('fc_ipa_pick_word')}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{q.word.word}</div>
            <div style={{ color: 'var(--text-muted)' }}>{t('fc_ipa_pick_ipa')}</div>
          </>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          width: 'min(90vw, 520px)',
        }}
      >
        {q.options.map((opt, i) => {
          let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
          if (picked) {
            if (opt === q.answer) variant = 'primary';
            else if (opt === picked) variant = 'danger';
          }
          return (
            <FBtn
              key={i}
              variant={variant}
              block={true}
              onClick={() => pick(opt)}
              style={q.direction === 'word-to-ipa' ? ipaStyle : undefined}
            >
              {opt}
            </FBtn>
          );
        })}
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
