import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import { shuffle, meaningOf, flashcardImagePath } from './game-utils.js';
import type { GameProps } from './game-utils.js';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn, IconButton: FIB } = DS;

/**
 * `text` and `audio` ask which meaning fits the word. `image` runs the other way round — the
 * picture is the prompt and the options are English words — which is the whole point of putting a
 * picture on a card: recognising the thing without translating first.
 */
type Question = {
  word: FlashcardWordRow;
  prompt: 'text' | 'audio' | 'image';
  options: string[];
  answer: string;
};

/** Roughly how often a word that has a picture is asked as a picture question. */
const IMAGE_SHARE = 0.35;

// Exported for tests: the picture variant is chosen at random, so its shape is asserted directly
// rather than by driving the UI and hoping the dice land.
export function buildQuestions(words: FlashcardWordRow[]): Question[] {
  // A picture question needs three other spellings to choose between. Deck size already gates the
  // mode at MIN_WORDS.quiz = 4, but a deck of near-duplicates can still come up short per word.
  return shuffle(words).map((w) => {
    if (w.imageKey && Math.random() < IMAGE_SHARE) {
      const wordDistractors = shuffle(
        Array.from(new Set(words.filter((o) => o.id !== w.id).map((o) => o.word))).filter(
          (o) => o !== w.word,
        ),
      ).slice(0, 3);
      if (wordDistractors.length === 3) {
        return {
          word: w,
          prompt: 'image' as const,
          options: shuffle([w.word, ...wordDistractors]),
          answer: w.word,
        };
      }
      // Not enough distinct spellings — fall through to the meaning question below.
    }
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
      prompt: Math.random() < 0.35 ? ('audio' as const) : ('text' as const),
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
        {q.prompt === 'image' ? (
          <>
            {/* The word itself is deliberately not shown — it is one of the four options. */}
            <img
              src={flashcardImagePath(q.word.imageKey) ?? undefined}
              alt=""
              draggable={false}
              style={{
                width: 'min(70vw, 340px)',
                aspectRatio: '3 / 2',
                objectFit: 'cover',
                borderRadius: 14,
                border: '1px solid var(--line, #e7e0d6)',
                userSelect: 'none',
              }}
            />
            <div style={{ color: 'var(--text-muted)' }}>{t('fc_pick_word')}</div>
          </>
        ) : q.prompt === 'audio' ? (
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
