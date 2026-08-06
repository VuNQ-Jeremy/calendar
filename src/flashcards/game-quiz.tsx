import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import { shuffle, meaningOf } from './game-utils.js';
import type { GameProps } from './game-utils.js';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn, IconButton: FIB } = DS;

type Question = {
  word: FlashcardWordRow;
  prompt: 'text' | 'audio';
  options: string[];
  answer: string;
};

function buildQuestions(words: FlashcardWordRow[]): Question[] {
  return shuffle(words).map((w) => {
    const answer = meaningOf(w);
    const distractors = shuffle(
      Array.from(
        new Set(
          words
            .filter((o) => o.id !== w.id)
            .map(meaningOf)
            .filter((m) => m !== answer),
        ),
      ),
    ).slice(0, 3);
    return {
      word: w,
      prompt: Math.random() < 0.35 ? 'audio' : 'text',
      options: shuffle([answer, ...distractors]),
      answer,
    };
  });
}

export function QuizGame({ words, onExit, onFinish, garden }: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [questions, setQuestions] = React.useState<Question[]>(() => buildQuestions(words));
  const [idx, setIdx] = React.useState(0);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const finished = React.useRef(false);

  const done = idx >= questions.length;
  const score = answers.filter((a) => a.correct).length;

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({ mode: 'quiz', score, total: questions.length, answers });
    }
  }, [done, score, questions.length, answers, onFinish]);

  const pick = (opt: string) => {
    if (picked) return;
    const q = questions[idx];
    setPicked(opt);
    setAnswers((a) => [...a, { wordId: q.word.id, correct: opt === q.answer }]);
    setTimeout(() => {
      setPicked(null);
      setIdx((i) => i + 1);
    }, 900);
  };

  const replay = () => {
    finished.current = false;
    setQuestions(buildQuestions(words));
    setAnswers([]);
    setIdx(0);
    setPicked(null);
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

  const q = questions[idx];
  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        {q.prompt === 'audio' ? (
          <>
            <FIB label={t('fc_play_audio')} size="md" onClick={() => playWord(q.word.word)}>
              <MIcon name="volume" size={32} />
            </FIB>
            <div style={{ color: 'var(--text-muted)' }}>{t('fc_listen_pick')}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{q.word.word}</div>
            <div style={{ color: 'var(--text-muted)' }}>{t('fc_pick_meaning')}</div>
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
            <FBtn key={i} variant={variant} block={true} onClick={() => pick(opt)}>
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
