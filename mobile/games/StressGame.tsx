import React from 'react';
import { View } from 'react-native';
import { buildStressQuestions } from '@mochi/shared/logic/flashcards';
import type { StressQuestion } from '@mochi/shared/logic/flashcards';
import { useWordAudio } from '~/lib/use-word-audio';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, Mono, Muted, Title } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-stress.tsx`. `odd`: four words, three share a stress position,
 * pick the one that differs. `syllable`: one word, pick which syllable is stressed. The IPA is
 * never shown before an answer — it IS the answer — but is revealed afterward alongside the audio.
 */

type Question = StressQuestion<FlashcardWordRow>;

export function StressGame({ words, roundSize, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();

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
    play(q.words.find((w) => w.id === q.answerId)?.word ?? '');
    timer.current = setTimeout(advance, 1400);
  };

  const pickSyllable = (q: Extract<Question, { kind: 'syllable' }>, syllable: number) => {
    if (picked !== null) return;
    setPicked(syllable);
    const correct = syllable === q.answer;
    setAnswers((a) => [...a, { wordId: q.word.id, correct }]);
    play(q.word.word);
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
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: th.spacing[4],
          padding: th.spacing[6],
        }}
      >
        <Muted>{t('fc_stress_none')}</Muted>
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

      {q.kind === 'odd' ? (
        <>
          <Muted>{t('fc_stress_odd')}</Muted>
          <View style={{ width: '100%', maxWidth: 520, gap: th.spacing[3] }}>
            {q.words.map((w) => {
              let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
              if (picked !== null) {
                if (w.id === q.answerId) variant = 'primary';
                else if (w.id === picked) variant = 'danger';
              }
              return (
                <Button
                  key={w.id}
                  variant={variant}
                  block
                  size="lg"
                  onPress={() => pickOdd(q, w.id)}
                >
                  {w.word}
                </Button>
              );
            })}
          </View>
          {picked !== null ? <Mono>{q.words.find((w) => w.id === q.answerId)?.ipa}</Mono> : null}
        </>
      ) : (
        <>
          <Title style={{ ...th.text.xxl, fontFamily: th.font.displayBold, textAlign: 'center' }}>
            {q.word.word}
          </Title>
          <Muted>{t('fc_stress_syllable')}</Muted>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: th.spacing[3],
              justifyContent: 'center',
            }}
          >
            {Array.from({ length: q.syllables }, (_, i) => {
              let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
              if (picked !== null) {
                if (i === q.answer) variant = 'primary';
                else if (i === picked) variant = 'danger';
              }
              return (
                <Button key={i} variant={variant} onPress={() => pickSyllable(q, i)}>
                  {t('fc_syllable_n', { n: i + 1 })}
                </Button>
              );
            })}
          </View>
          {picked !== null ? <Mono>{q.word.ipa}</Mono> : null}
        </>
      )}
    </View>
  );
}
