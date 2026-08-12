import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { playSentence } from './audio.js';
import type { GameProps } from './game-utils.js';
import {
  buildListenQuestions,
  checkTyped,
  type ListenQuestion,
} from '../../shared/logic/flashcards';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn, IconButton: FIB } = DS;

/**
 * Nghe điền từ — the full example sentence is spoken (auto-play on arrival, plus replay and slow
 * replay), the screen shows it blanked, and the student types the missing word from memory. One
 * attempt per word, graded like `type`: case-, whitespace- and diacritic-insensitive.
 */

type Question = ListenQuestion<FlashcardWordRow>;

export function ListenGame({
  words,
  roundSize,
  onExit,
  onFinish,
  garden,
}: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [questions, setQuestions] = React.useState<Question[]>(() =>
    buildListenQuestions(words, roundSize),
  );
  const [idx, setIdx] = React.useState(0);
  const [input, setInput] = React.useState('');
  const [verdict, setVerdict] = React.useState<'correct' | 'wrong' | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const done = questions.length > 0 && idx >= questions.length;
  const score = answers.filter((a) => a.correct).length;
  const q = questions[idx];

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({
        mode: 'listen',
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

  // Speak the sentence as soon as it is shown, and refocus the input for the next question.
  React.useEffect(() => {
    if (!done && q) playSentence(q.sentence);
    if (!verdict && !done) inputRef.current?.focus();
  }, [idx, verdict, done, q]);

  const submit = () => {
    if (verdict || !input.trim() || !q) return;
    const correct = checkTyped(input, q.answer);
    setVerdict(correct ? 'correct' : 'wrong');
    setAnswers((a) => [...a, { wordId: q.word.id, correct }]);
    if (!correct) playSentence(q.sentence);
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
    setQuestions(buildListenQuestions(words, roundSize));
    setAnswers([]);
    setIdx(0);
    setInput('');
    setVerdict(null);
    started.current = Date.now();
  };

  if (questions.length === 0) {
    return (
      <div style={endWrap}>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_sentence_none')}</div>
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

  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div className="m-row" style={{ gap: 8 }}>
          <FIB label={t('fc_play_audio')} size="md" onClick={() => playSentence(q.sentence)}>
            <MIcon name="volume" size={28} />
          </FIB>
          <FBtn variant="ghost" onClick={() => playSentence(q.sentence, 0.6)}>
            {t('fc_listen_slow')}
          </FBtn>
        </div>
        <div
          style={{
            fontSize: 'var(--text-lg, 22px)',
            fontWeight: 700,
            textAlign: 'center',
            maxWidth: 520,
          }}
        >
          {q.blanked}
        </div>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_listen_prompt')}</div>
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
            {t('fc_correct_was', { word: q.answer })}
          </div>
        ) : (
          <FBtn
            variant="primary"
            block={true}
            disabled={!input.trim() || !!verdict}
            onClick={submit}
          >
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
