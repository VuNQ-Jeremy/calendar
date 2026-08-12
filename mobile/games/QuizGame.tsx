import React from 'react';
import { Image, View } from 'react-native';
import { Volume2 } from 'lucide-react-native';
import { buildQuizQuestions, type QuizQuestion } from '@mochi/shared/logic/flashcards';
import { imageOf } from '@mochi/shared/logic/flashcards';
import { BASE } from '~/lib/api';
import { useWordAudio } from '~/lib/use-word-audio';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, IconButton, Muted, Title } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-quiz.tsx`. Plain taps — no gestures — so this is close to a
 * transliteration: `onClick` becomes `onPress`, the CSS grid becomes a wrapping flex row.
 *
 * The scoring, the 35% audio/image-prompt chance, the three distractors and the 900ms reveal
 * delay are all unchanged — `buildQuizQuestions` is the exact function the web uses. A student's
 * score must not depend on which client they played on.
 */

type Question = QuizQuestion<FlashcardWordRow>;

export function QuizGame({ words, roundSize, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();

  const [questions, setQuestions] = React.useState<Question[]>(() =>
    buildQuizQuestions(words, roundSize),
  );
  const [idx, setIdx] = React.useState(0);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const done = idx >= questions.length;
  const score = answers.filter((a) => a.correct).length;

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({ mode: 'quiz', score, total: questions.length, answers });
    }
  }, [done, score, questions.length, answers, onFinish]);

  // Leaving mid-question would otherwise advance a screen that is no longer mounted.
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
    timer.current = setTimeout(() => {
      setPicked(null);
      setIdx((i) => i + 1);
    }, 900);
  };

  const replay = () => {
    finished.current = false;
    setQuestions(buildQuizQuestions(words, roundSize));
    setAnswers([]);
    setIdx(0);
    setPicked(null);
  };

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

      <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
        {q.prompt === 'image' ? (
          <>
            {imageOf(q.word, BASE) ? (
              <Image
                source={{ uri: imageOf(q.word, BASE) as string }}
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
            <Muted>{t('fc_pick_word')}</Muted>
          </>
        ) : q.prompt === 'audio' ? (
          <>
            <IconButton
              variant="solid"
              label={t('fc_play_audio')}
              onPress={() => play(q.word.word)}
            >
              <Volume2 size={28} color={th.color.textOnBrand} />
            </IconButton>
            <Muted>{t('fc_listen_pick')}</Muted>
          </>
        ) : (
          <>
            <Title style={{ ...th.text.xxl, fontFamily: th.font.displayBold, textAlign: 'center' }}>
              {q.word.word}
            </Title>
            <Muted>{t('fc_pick_meaning')}</Muted>
          </>
        )}
      </View>

      <View style={{ width: '100%', maxWidth: 520, gap: th.spacing[3] }}>
        {q.options.map((opt, i) => {
          // Same reveal as the web: the right answer turns primary, a wrong pick turns danger.
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
