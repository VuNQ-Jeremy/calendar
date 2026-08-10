import React from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { checkTyped, meaningOf, pickRound, typeEligible } from '@mochi/shared/logic/flashcards';
import { useWordAudio } from '~/lib/use-word-audio';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, Muted, Title } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-type.tsx`. The Vietnamese meaning as the prompt, the English word
 * typed from memory, graded by `checkTyped` — the same case/whitespace/diacritic forgiveness as
 * the web and the tests module. A miss shows the correct spelling and plays its audio.
 */

export function TypeGame({ words, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();

  const [round, setRound] = React.useState<FlashcardWordRow[]>(() =>
    pickRound(words.filter(typeEligible)),
  );
  const [idx, setIdx] = React.useState(0);
  const [input, setInput] = React.useState('');
  const [verdict, setVerdict] = React.useState<'correct' | 'wrong' | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = React.useRef<TextInput>(null);

  const done = round.length > 0 && idx >= round.length;
  const score = answers.filter((a) => a.correct).length;
  const w = round[idx];

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({
        mode: 'type',
        score,
        total: round.length,
        durationMs: Date.now() - started.current,
        answers,
      });
    }
  }, [done, score, round.length, answers, onFinish]);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const submit = () => {
    if (verdict || !input.trim() || !w) return;
    const correct = checkTyped(input, w.word);
    setVerdict(correct ? 'correct' : 'wrong');
    setAnswers((a) => [...a, { wordId: w.id, correct }]);
    if (!correct) play(w.word);
    timer.current = setTimeout(
      () => {
        setVerdict(null);
        setInput('');
        setIdx((i) => i + 1);
        inputRef.current?.focus();
      },
      correct ? 700 : 1800,
    );
  };

  const replay = () => {
    finished.current = false;
    setRound(pickRound(words.filter(typeEligible)));
    setAnswers([]);
    setIdx(0);
    setInput('');
    setVerdict(null);
    started.current = Date.now();
  };

  // Every word's meaning IS the word (imported without translations): nothing askable.
  if (round.length === 0) {
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
        <Muted>{t('fc_no_words')}</Muted>
        <Button variant="secondary" onPress={onExit}>
          {t('fc_exit')}
        </Button>
      </View>
    );
  }

  if (done) {
    return (
      <GameEnd
        headline={`${t('fc_score')}: ${score}/${round.length}`}
        onReplay={replay}
        onExit={onExit}
      >
        {endNote}
      </GameEnd>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
          {t('fc_question_of', { i: idx + 1, n: round.length })} · {t('fc_score')}: {score}
        </Muted>

        <View style={{ alignItems: 'center', gap: th.spacing[2] }}>
          <Title style={{ ...th.text.xxl, fontFamily: th.font.displayBold, textAlign: 'center' }}>
            {meaningOf(w)}
          </Title>
          <Muted>{t('fc_type_prompt')}</Muted>
        </View>

        <View style={{ width: '100%', maxWidth: 420, gap: th.spacing[3] }}>
          <TextInput
            ref={inputRef}
            autoFocus={true}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={verdict === null}
            placeholder={t('fc_type_placeholder')}
            placeholderTextColor={th.color.textDisabled}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={submit}
            blurOnSubmit={false}
            returnKeyType="done"
            style={{
              minHeight: th.touch,
              paddingHorizontal: th.spacing[4],
              paddingVertical: 0,
              textAlign: 'center',
              fontFamily: th.font.bodyBold,
              fontSize: th.text.lg.fontSize,
              color: th.color.textStrong,
              backgroundColor: th.color.surfaceCard,
              borderWidth: 1.5,
              borderRadius: th.radius.md,
              borderColor:
                verdict === 'correct'
                  ? th.status.success
                  : verdict === 'wrong'
                    ? th.status.danger
                    : th.color.borderStrong,
            }}
          />
          {verdict === 'wrong' ? (
            <Text
              style={{
                fontFamily: th.font.bodyBold,
                color: th.color.textStrong,
                textAlign: 'center',
              }}
            >
              {t('fc_correct_was', { word: w.word })}
            </Text>
          ) : (
            <Button block disabled={!input.trim() || verdict !== null} onPress={submit}>
              {t('fc_check')}
            </Button>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
