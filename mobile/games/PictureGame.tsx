import React from 'react';
import { Image, View } from 'react-native';
import { buildPictureQuestions, imageOf } from '@mochi/shared/logic/flashcards';
import type { PictureQuestion } from '@mochi/shared/logic/flashcards';
import { BASE } from '~/lib/api';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, Muted } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-picture.tsx`. The picture is the prompt, four English words are
 * the options — quiz-shaped, same reveal colors and 900ms advance. Images come from the API host
 * (`imageOf` with the bearer-API base; the route is capability-URL, no auth header needed), so an
 * offline round with a cold image cache shows an empty frame rather than crashing — and a bundle
 * whose word rows carry no `imageKey` yet builds zero questions and lands on the empty panel.
 */

export function PictureGame({ words, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
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
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: th.spacing[4],
          padding: th.spacing[6],
        }}
      >
        <Muted>{t('fc_picture_none')}</Muted>
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
  const src = imageOf(q.word, BASE);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: th.spacing[5],
        padding: th.spacing[6],
      }}
    >
      <Muted style={{ fontFamily: th.font.bodyBold }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </Muted>

      {src ? (
        <Image
          source={{ uri: src }}
          resizeMode="cover"
          style={{
            width: 240,
            height: 240,
            borderRadius: th.radius.lg,
            borderWidth: 1,
            borderColor: th.color.borderSubtle,
            backgroundColor: th.color.surfaceCard,
          }}
        />
      ) : null}
      <Muted>{t('fc_picture_pick')}</Muted>

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
