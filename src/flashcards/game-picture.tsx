import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import type { GameProps } from './game-utils.js';
import { buildPictureQuestions, imageOf } from '../../shared/logic/flashcards';
import type { PictureQuestion } from '../../shared/logic/flashcards';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn } = DS;

/**
 * Nhìn hình đoán từ — the picture is the prompt, four English words are the options. Quiz-shaped
 * on purpose: same reveal colors, same 900ms advance, same scoring.
 *
 * Only words with an `imageKey` are asked (`buildPictureQuestions`); distractors are word strings
 * from the whole topic, images not required. Until the image column ships on word rows this
 * builds zero questions and renders the "no pictures yet" panel — the launcher is normally
 * disabled first, but a `?review=1` deck can narrow to imageless words after the button was drawn.
 */

export function PictureGame({ words, onExit, onFinish, garden }: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [questions, setQuestions] = React.useState<PictureQuestion<FlashcardWordRow>[]>(() =>
    buildPictureQuestions(words),
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
        mode: 'picture',
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

  const pick = (opt: string) => {
    if (picked) return;
    const q = questions[idx];
    setPicked(opt);
    setAnswers((a) => [...a, { wordId: q.word.id, correct: opt === q.answer }]);
    timer.current = setTimeout(() => {
      setPicked(null);
      setIdx((i) => i + 1);
    }, 900);
  };

  const replay = () => {
    finished.current = false;
    setQuestions(buildPictureQuestions(words));
    setAnswers([]);
    setIdx(0);
    setPicked(null);
    started.current = Date.now();
  };

  if (questions.length === 0) {
    return (
      <div style={endWrap}>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_picture_none')}</div>
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
  const src = imageOf(q.word);

  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </div>

      {src && (
        <img
          src={src}
          alt=""
          style={{
            width: 'min(80vw, 280px)',
            height: 'min(80vw, 280px)',
            objectFit: 'cover',
            borderRadius: 16,
            border: '1px solid var(--line, #e7e0d6)',
            background: 'var(--bg-card, #fff)',
          }}
        />
      )}
      <div style={{ color: 'var(--text-muted)' }}>{t('fc_picture_pick')}</div>

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
  gap: 20,
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
