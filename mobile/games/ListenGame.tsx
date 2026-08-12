import React from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { Volume2 } from 'lucide-react-native';
import { buildListenQuestions, checkTyped } from '@mochi/shared/logic/flashcards';
import type { ListenQuestion } from '@mochi/shared/logic/flashcards';
import { useWordAudio } from '~/lib/use-word-audio';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, IconButton, Muted, Title } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-listen.tsx`. The full example sentence is spoken (auto-play on
 * arrival, plus replay and slow-replay), the screen shows it blanked, and the student types the
 * missing word from memory. Graded like `type`: case-, whitespace- and diacritic-insensitive.
 */

type Question = ListenQuestion<FlashcardWordRow>;

export function ListenGame({ words, roundSize, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();

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
  const inputRef = React.useRef<TextInput>(null);

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

  // Speak the sentence as soon as it is shown.
  React.useEffect(() => {
    if (!done && q) play(q.sentence);
  }, [idx, done, q]);

  const submit = () => {
    if (verdict || !input.trim() || !q) return;
    const correct = checkTyped(input, q.answer);
    setVerdict(correct ? 'correct' : 'wrong');
    setAnswers((a) => [...a, { wordId: q.word.id, correct }]);
    if (!correct) play(q.sentence);
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
    setQuestions(buildListenQuestions(words, roundSize));
    setAnswers([]);
    setIdx(0);
    setInput('');
    setVerdict(null);
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
          {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
        </Muted>

        <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
          <View style={{ flexDirection: 'row', gap: th.spacing[2], alignItems: 'center' }}>
            <IconButton variant="solid" label={t('fc_play_audio')} onPress={() => play(q.sentence)}>
              <Volume2 size={24} color={th.color.textOnBrand} />
            </IconButton>
            <Button variant="ghost" onPress={() => play(q.sentence, 0.6)}>
              {t('fc_listen_slow')}
            </Button>
          </View>
          <Title
            style={{
              ...th.text.lg,
              fontFamily: th.font.bodyBold,
              textAlign: 'center',
              maxWidth: 520,
            }}
          >
            {q.blanked}
          </Title>
          <Muted>{t('fc_listen_prompt')}</Muted>
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
              {t('fc_correct_was', { word: q.answer })}
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
