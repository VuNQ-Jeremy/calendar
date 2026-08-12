import React from 'react';
import { View } from 'react-native';
import { buildClozeQuestions, CLOZE_BLANK } from '@mochi/shared/logic/flashcards';
import type { ClozeQuestion } from '@mochi/shared/logic/flashcards';
import { useWordAudio } from '~/lib/use-word-audio';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, Muted, Title } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-cloze.tsx`. The word's own example sentence, blanked, with four
 * options (the answer plus three other topic words). Answering reveals the full sentence and
 * speaks it, so the round doubles as listening practice.
 */

type Question = ClozeQuestion<FlashcardWordRow>;

export function ClozeGame({ words, roundSize, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();

  const [questions, setQuestions] = React.useState<Question[]>(() =>
    buildClozeQuestions(words, roundSize),
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
        mode: 'cloze',
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
    if (q.word.exampleEn) play(q.word.exampleEn);
    timer.current = setTimeout(() => {
      setPicked(null);
      setIdx((i) => i + 1);
    }, 1400);
  };

  const replay = () => {
    finished.current = false;
    setQuestions(buildClozeQuestions(words, roundSize));
    setAnswers([]);
    setIdx(0);
    setPicked(null);
    started.current = Date.now();
  };

  if (questions.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: th.spacing[4],
          padding: th.spacing[6],
        }}
      >
        <Muted>{t('fc_sentence_none')}</Muted>
        <Button variant="secondary" onPress={onExit}>
          {t('fc_exit')}
        </Button>
      </View>
    );
  }

  if (done) {
    return (
      <GameEnd
        headline={`${t('fc_score')}: ${score}/${questions.length}`}
        onReplay={replay}
        onExit={onExit}
      >
        {endNote}
      </GameEnd>
    );
  }

  const q = questions[idx];
  const shown = picked
    ? q.blanked.replace(CLOZE_BLANK, picked === q.answer ? q.answer : `[${picked}]`)
    : q.blanked;

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: th.spacing[6],
        padding: th.spacing[6],
      }}
    >
      <Muted style={{ fontFamily: th.font.bodyBold }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </Muted>

      <View style={{ alignItems: 'center', gap: th.spacing[3], maxWidth: 520 }}>
        <Title style={{ ...th.text.lg, fontFamily: th.font.bodyBold, textAlign: 'center' }}>
          {shown}
        </Title>
        <Muted>{t('fc_cloze_prompt')}</Muted>
      </View>

      <View style={{ width: '100%', maxWidth: 520, gap: th.spacing[3] }}>
        {q.options.map((opt, i) => {
          let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
          if (picked) {
            if (opt === q.answer) variant = 'primary';
            else if (opt === picked) variant = 'danger';
          }
          return (
            <Button key={`${i}-${opt}`} variant={variant} block size="lg" onPress={() => pick(opt)}>
              {opt}
            </Button>
          );
        })}
      </View>
    </View>
  );
}
