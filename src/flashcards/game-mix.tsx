import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { playWord, playSentence } from './audio.js';
import { flashcardImagePath } from './game-utils.js';
import type { GameProps } from './game-utils.js';
import {
  buildMixItems,
  checkTyped,
  CLOZE_BLANK,
  DEFAULT_ROUND_SIZE,
  meaningOf,
  mixEligibleModes,
  type GameMode,
  type MixItem,
} from '../../shared/logic/flashcards';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn, IconButton: FIB } = DS;

/**
 * Tổng hợp — one round drawing from whichever auto-graded modes the assignment allows (or every
 * one the deck supports, when nothing narrows it): quiz, type, picture, IPA, stress, cloze,
 * listen. Each item renders its own small question body; grading rules are borrowed verbatim from
 * the standalone game each mode belongs to.
 */

type Item = MixItem<FlashcardWordRow>;

export function MixGame({
  words,
  roundSize,
  allowedModes,
  onExit,
  onFinish,
  garden,
}: GameProps & GardenRoundProps & { allowedModes: GameMode[] | null }) {
  const { t } = useLang();
  const build = React.useCallback(() => {
    const modes = mixEligibleModes(words, allowedModes);
    return buildMixItems(words, modes, roundSize ?? DEFAULT_ROUND_SIZE);
  }, [words, allowedModes, roundSize]);

  const [items, setItems] = React.useState<Item[]>(build);
  const [idx, setIdx] = React.useState(0);
  const [mcqPicked, setMcqPicked] = React.useState<string | null>(null);
  const [stressPicked, setStressPicked] = React.useState<string | number | null>(null);
  const [typedInput, setTypedInput] = React.useState('');
  const [typedVerdict, setTypedVerdict] = React.useState<'correct' | 'wrong' | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const done = items.length > 0 && idx >= items.length;
  const score = answers.filter((a) => a.correct).length;
  const item = items[idx];

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({
        mode: 'mix',
        score,
        total: items.length,
        durationMs: Date.now() - started.current,
        answers,
      });
    }
  }, [done, score, items.length, answers, onFinish]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  React.useEffect(() => {
    if (done || !item) return;
    if (item.mode === 'listen') playSentence(item.question.sentence);
    if (item.mode === 'type' || item.mode === 'listen') inputRef.current?.focus();
  }, [idx, done, item]);

  const advance = (delay: number) => {
    timer.current = setTimeout(() => {
      setMcqPicked(null);
      setStressPicked(null);
      setTypedInput('');
      setTypedVerdict(null);
      setIdx((i) => i + 1);
    }, delay);
  };

  const answer = (wordId: string, correct: boolean) =>
    setAnswers((a) => [...a, { wordId, correct }]);

  const pickMcq = (opt: string) => {
    if (mcqPicked || !item) return;
    setMcqPicked(opt);
    if (
      item.mode === 'quiz' ||
      item.mode === 'picture' ||
      item.mode === 'ipa' ||
      item.mode === 'cloze'
    ) {
      const correct = opt === item.question.answer;
      answer(item.question.word.id, correct);
      if (item.mode === 'ipa') playWord(item.question.word.word);
      if (item.mode === 'cloze' && item.question.word.exampleEn) {
        playSentence(item.question.word.exampleEn);
      }
    }
    advance(900);
  };

  const pickStress = (value: string | number) => {
    if (stressPicked !== null || !item || item.mode !== 'stress') return;
    setStressPicked(value);
    const q = item.question;
    if (q.kind === 'odd') {
      const correct = value === q.answerId;
      answer(q.answerId, correct);
      playWord(q.words.find((w) => w.id === q.answerId)?.word ?? '');
    } else {
      const correct = value === q.answer;
      answer(q.word.id, correct);
      playWord(q.word.word);
    }
    advance(1400);
  };

  const submitTyped = () => {
    if (typedVerdict || !typedInput.trim() || !item) return;
    if (item.mode === 'type') {
      const correct = checkTyped(typedInput, item.word.word);
      setTypedVerdict(correct ? 'correct' : 'wrong');
      answer(item.word.id, correct);
      if (!correct) playWord(item.word.word);
      advance(correct ? 700 : 1800);
    } else if (item.mode === 'listen') {
      const correct = checkTyped(typedInput, item.question.answer);
      setTypedVerdict(correct ? 'correct' : 'wrong');
      answer(item.question.word.id, correct);
      if (!correct) playSentence(item.question.sentence);
      advance(correct ? 700 : 1800);
    }
  };

  const replay = () => {
    finished.current = false;
    setItems(build());
    setAnswers([]);
    setIdx(0);
    setMcqPicked(null);
    setStressPicked(null);
    setTypedInput('');
    setTypedVerdict(null);
    started.current = Date.now();
  };

  if (items.length === 0) {
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
          {t('fc_score')}: {score}/{items.length}
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
      <div className="m-row" style={{ gap: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
        <span>
          {t('fc_question_of', { i: idx + 1, n: items.length })} · {t('fc_score')}: {score}
        </span>
        <span
          style={{
            fontSize: 'var(--text-xs, 12px)',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 8,
            background: 'var(--brand-soft, #fdeede)',
            color: 'var(--brand, #f79a4e)',
          }}
        >
          {t(`fc_mode_${item.mode}`)}
        </span>
      </div>

      <MixItemBody
        item={item}
        mcqPicked={mcqPicked}
        stressPicked={stressPicked}
        typedInput={typedInput}
        typedVerdict={typedVerdict}
        inputRef={inputRef}
        onPickMcq={pickMcq}
        onPickStress={pickStress}
        onTypedChange={setTypedInput}
        onSubmitTyped={submitTyped}
        t={t}
      />
    </div>
  );
}

/** Renders one mixed-round question body. Split out purely to keep MixGame's hooks flat. */
function MixItemBody({
  item,
  mcqPicked,
  stressPicked,
  typedInput,
  typedVerdict,
  inputRef,
  onPickMcq,
  onPickStress,
  onTypedChange,
  onSubmitTyped,
  t,
}: {
  item: Item;
  mcqPicked: string | null;
  stressPicked: string | number | null;
  typedInput: string;
  typedVerdict: 'correct' | 'wrong' | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPickMcq: (opt: string) => void;
  onPickStress: (value: string | number) => void;
  onTypedChange: (v: string) => void;
  onSubmitTyped: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (item.mode === 'quiz') {
    const q = item.question;
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {q.prompt === 'image' ? (
            <img
              src={flashcardImagePath(q.word.imageKey) ?? undefined}
              alt=""
              draggable={false}
              style={imgStyle}
            />
          ) : q.prompt === 'audio' ? (
            <FIB label={t('fc_play_audio')} size="md" onClick={() => playWord(q.word.word)}>
              <MIcon name="volume" size={32} />
            </FIB>
          ) : (
            <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{q.word.word}</div>
          )}
          <div style={{ color: 'var(--text-muted)' }}>
            {q.prompt === 'image' ? t('fc_pick_word') : t('fc_pick_meaning')}
          </div>
        </div>
        <McqOptions options={q.options} answer={q.answer} picked={mcqPicked} onPick={onPickMcq} />
      </>
    );
  }

  if (item.mode === 'picture') {
    const q = item.question;
    return (
      <>
        <img src={flashcardImagePath(q.word.imageKey) ?? undefined} alt="" style={imgStyle} />
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_picture_pick')}</div>
        <McqOptions options={q.options} answer={q.answer} picked={mcqPicked} onPick={onPickMcq} />
      </>
    );
  }

  if (item.mode === 'ipa') {
    const q = item.question;
    const ipaStyle: React.CSSProperties = { fontFamily: 'var(--font-mono, monospace)' };
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          {q.direction === 'ipa-to-word' ? (
            <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800, ...ipaStyle }}>
              {q.word.ipa}
            </div>
          ) : (
            <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{q.word.word}</div>
          )}
          <div style={{ color: 'var(--text-muted)' }}>
            {q.direction === 'ipa-to-word' ? t('fc_ipa_pick_word') : t('fc_ipa_pick_ipa')}
          </div>
        </div>
        <McqOptions
          options={q.options}
          answer={q.answer}
          picked={mcqPicked}
          onPick={onPickMcq}
          optionStyle={q.direction === 'word-to-ipa' ? ipaStyle : undefined}
        />
      </>
    );
  }

  if (item.mode === 'cloze') {
    const q = item.question;
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ ...sentenceStyle }}>
            {mcqPicked
              ? q.blanked.replace(CLOZE_BLANK, mcqPicked === q.answer ? q.answer : `[${mcqPicked}]`)
              : q.blanked}
          </div>
          <div style={{ color: 'var(--text-muted)' }}>{t('fc_cloze_prompt')}</div>
        </div>
        <McqOptions options={q.options} answer={q.answer} picked={mcqPicked} onPick={onPickMcq} />
      </>
    );
  }

  if (item.mode === 'stress') {
    const q = item.question;
    if (q.kind === 'odd') {
      return (
        <>
          <div style={{ color: 'var(--text-muted)' }}>{t('fc_stress_odd')}</div>
          <div style={optionsGrid}>
            {q.words.map((w) => {
              let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
              if (stressPicked !== null) {
                if (w.id === q.answerId) variant = 'primary';
                else if (w.id === stressPicked) variant = 'danger';
              }
              return (
                <FBtn key={w.id} variant={variant} block={true} onClick={() => onPickStress(w.id)}>
                  {w.word}
                </FBtn>
              );
            })}
          </div>
        </>
      );
    }
    return (
      <>
        <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{q.word.word}</div>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_stress_syllable')}</div>
        <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          {Array.from({ length: q.syllables }, (_, i) => {
            let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
            if (stressPicked !== null) {
              if (i === q.answer) variant = 'primary';
              else if (i === stressPicked) variant = 'danger';
            }
            return (
              <FBtn key={i} variant={variant} onClick={() => onPickStress(i)}>
                {t('fc_syllable_n', { n: i + 1 })}
              </FBtn>
            );
          })}
        </div>
      </>
    );
  }

  // type / listen — a typed-input question.
  const prompt = item.mode === 'listen' ? item.question.blanked : meaningOf(item.word);
  const hint = item.mode === 'listen' ? t('fc_listen_prompt') : t('fc_type_prompt');
  const correctWord = item.mode === 'listen' ? item.question.answer : item.word.word;
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={item.mode === 'listen' ? sentenceStyle : wordStyle}>{prompt}</div>
        <div style={{ color: 'var(--text-muted)' }}>{hint}</div>
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
          disabled={typedVerdict !== null}
          value={typedInput}
          onChange={(e) => onTypedChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmitTyped();
          }}
          style={{
            textAlign: 'center',
            fontSize: 'var(--text-md, 18px)',
            fontWeight: 700,
            ...(typedVerdict === 'correct'
              ? { borderColor: 'var(--green-600, #2e7d32)' }
              : typedVerdict === 'wrong'
                ? { borderColor: 'var(--red-600, #c0392b)' }
                : null),
          }}
        />
        {typedVerdict === 'wrong' ? (
          <div style={{ color: 'var(--text-strong)', fontWeight: 700, textAlign: 'center' }}>
            {t('fc_correct_was', { word: correctWord })}
          </div>
        ) : (
          <FBtn
            variant="primary"
            block={true}
            disabled={!typedInput.trim() || !!typedVerdict}
            onClick={onSubmitTyped}
          >
            {t('fc_check')}
          </FBtn>
        )}
      </div>
    </>
  );
}

function McqOptions({
  options,
  answer,
  picked,
  onPick,
  optionStyle,
}: {
  options: string[];
  answer: string;
  picked: string | null;
  onPick: (opt: string) => void;
  optionStyle?: React.CSSProperties;
}) {
  return (
    <div style={optionsGrid}>
      {options.map((opt, i) => {
        let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
        if (picked) {
          if (opt === answer) variant = 'primary';
          else if (opt === picked) variant = 'danger';
        }
        return (
          <FBtn
            key={i}
            variant={variant}
            block={true}
            onClick={() => onPick(opt)}
            style={optionStyle}
          >
            {opt}
          </FBtn>
        );
      })}
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

const optionsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  width: 'min(90vw, 520px)',
};

const imgStyle: React.CSSProperties = {
  width: 'min(70vw, 340px)',
  aspectRatio: '3 / 2',
  objectFit: 'cover',
  borderRadius: 14,
  border: '1px solid var(--line, #e7e0d6)',
  userSelect: 'none',
};

const sentenceStyle: React.CSSProperties = {
  fontSize: 'var(--text-lg, 22px)',
  fontWeight: 700,
  textAlign: 'center',
  maxWidth: 520,
};

const wordStyle: React.CSSProperties = {
  fontSize: 'var(--text-xl, 28px)',
  fontWeight: 800,
  textAlign: 'center',
};
