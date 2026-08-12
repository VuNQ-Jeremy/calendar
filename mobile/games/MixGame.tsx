import React from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { Volume2 } from 'lucide-react-native';
import {
  buildMixItems,
  checkTyped,
  CLOZE_BLANK,
  DEFAULT_ROUND_SIZE,
  imageOf,
  meaningOf,
  mixEligibleModes,
} from '@mochi/shared/logic/flashcards';
import type { GameMode, MixItem } from '@mochi/shared/logic/flashcards';
import { BASE } from '~/lib/api';
import { useWordAudio } from '~/lib/use-word-audio';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, IconButton, Mono, Muted, Title } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-mix.tsx`. One round drawing from whichever auto-graded modes the
 * assignment allows (or every one the deck supports): quiz, type, picture, IPA, stress, cloze,
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
  endNote,
}: GameProps & { allowedModes: GameMode[] | null }) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();

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
  const inputRef = React.useRef<TextInput>(null);

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
    if (item.mode === 'listen') play(item.question.sentence);
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
      if (item.mode === 'ipa') play(item.question.word.word);
      if (item.mode === 'cloze' && item.question.word.exampleEn) {
        play(item.question.word.exampleEn);
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
      play(q.words.find((w) => w.id === q.answerId)?.word ?? '');
    } else {
      const correct = value === q.answer;
      answer(q.word.id, correct);
      play(q.word.word);
    }
    advance(1400);
  };

  const submitTyped = () => {
    if (typedVerdict || !typedInput.trim() || !item) return;
    if (item.mode === 'type') {
      const correct = checkTyped(typedInput, item.word.word);
      setTypedVerdict(correct ? 'correct' : 'wrong');
      answer(item.word.id, correct);
      if (!correct) play(item.word.word);
      advance(correct ? 700 : 1800);
    } else if (item.mode === 'listen') {
      const correct = checkTyped(typedInput, item.question.answer);
      setTypedVerdict(correct ? 'correct' : 'wrong');
      answer(item.question.word.id, correct);
      if (!correct) play(item.question.sentence);
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
        headline={`${t('fc_score')}: ${score}/${items.length}`}
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
          gap: th.spacing[6],
          padding: th.spacing[6],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
          <Muted style={{ fontFamily: th.font.bodyBold }}>
            {t('fc_question_of', { i: idx + 1, n: items.length })} · {t('fc_score')}: {score}
          </Muted>
          <View
            style={{
              paddingHorizontal: th.spacing[2],
              paddingVertical: 2,
              borderRadius: th.radius.sm,
              backgroundColor: th.color.brandSoft,
            }}
          >
            <Text
              style={{
                fontFamily: th.font.bodyBold,
                fontSize: th.text.xs.fontSize,
                color: th.color.brandSoftInk,
              }}
            >
              {t(`fc_mode_${item.mode}`)}
            </Text>
          </View>
        </View>

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
          play={play}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

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
  play,
}: {
  item: Item;
  mcqPicked: string | null;
  stressPicked: string | number | null;
  typedInput: string;
  typedVerdict: 'correct' | 'wrong' | null;
  inputRef: React.RefObject<TextInput | null>;
  onPickMcq: (opt: string) => void;
  onPickStress: (value: string | number) => void;
  onTypedChange: (v: string) => void;
  onSubmitTyped: () => void;
  play: (text: string, rate?: number) => void;
}) {
  const th = useTheme();
  const { t } = useLang();

  if (item.mode === 'quiz') {
    const q = item.question;
    return (
      <>
        <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
          {q.prompt === 'image' ? (
            imageOf(q.word, BASE) ? (
              <Image
                source={{ uri: imageOf(q.word, BASE) as string }}
                resizeMode="cover"
                style={imgStyle(th)}
              />
            ) : null
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
            <Title style={{ ...th.text.xxl, fontFamily: th.font.displayBold, textAlign: 'center' }}>
              {q.word.word}
            </Title>
          )}
          {q.prompt === 'text' ? <Muted>{t('fc_pick_meaning')}</Muted> : null}
          {q.prompt === 'image' ? <Muted>{t('fc_pick_word')}</Muted> : null}
        </View>
        <McqOptions options={q.options} answer={q.answer} picked={mcqPicked} onPick={onPickMcq} />
      </>
    );
  }

  if (item.mode === 'picture') {
    const q = item.question;
    return (
      <>
        {imageOf(q.word, BASE) ? (
          <Image
            source={{ uri: imageOf(q.word, BASE) as string }}
            resizeMode="cover"
            style={imgStyle(th)}
          />
        ) : null}
        <Muted>{t('fc_picture_pick')}</Muted>
        <McqOptions options={q.options} answer={q.answer} picked={mcqPicked} onPick={onPickMcq} />
      </>
    );
  }

  if (item.mode === 'ipa') {
    const q = item.question;
    return (
      <>
        <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
          {q.direction === 'ipa-to-word' ? (
            <Mono style={{ ...th.text.xxl, textAlign: 'center' }}>{q.word.ipa}</Mono>
          ) : (
            <Title style={{ ...th.text.xxl, fontFamily: th.font.displayBold, textAlign: 'center' }}>
              {q.word.word}
            </Title>
          )}
          <Muted>
            {q.direction === 'ipa-to-word' ? t('fc_ipa_pick_word') : t('fc_ipa_pick_ipa')}
          </Muted>
        </View>
        <McqOptions options={q.options} answer={q.answer} picked={mcqPicked} onPick={onPickMcq} />
      </>
    );
  }

  if (item.mode === 'cloze') {
    const q = item.question;
    const shown = mcqPicked
      ? q.blanked.replace(CLOZE_BLANK, mcqPicked === q.answer ? q.answer : `[${mcqPicked}]`)
      : q.blanked;
    return (
      <>
        <View style={{ alignItems: 'center', gap: th.spacing[3], maxWidth: 520 }}>
          <Title style={{ ...th.text.lg, fontFamily: th.font.bodyBold, textAlign: 'center' }}>
            {shown}
          </Title>
          <Muted>{t('fc_cloze_prompt')}</Muted>
        </View>
        <McqOptions options={q.options} answer={q.answer} picked={mcqPicked} onPick={onPickMcq} />
      </>
    );
  }

  if (item.mode === 'stress') {
    const q = item.question;
    if (q.kind === 'odd') {
      return (
        <>
          <Muted>{t('fc_stress_odd')}</Muted>
          <View style={{ width: '100%', maxWidth: 520, gap: th.spacing[3] }}>
            {q.words.map((w) => {
              let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
              if (stressPicked !== null) {
                if (w.id === q.answerId) variant = 'primary';
                else if (w.id === stressPicked) variant = 'danger';
              }
              return (
                <Button
                  key={w.id}
                  variant={variant}
                  block
                  size="lg"
                  onPress={() => onPickStress(w.id)}
                >
                  {w.word}
                </Button>
              );
            })}
          </View>
        </>
      );
    }
    return (
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
            if (stressPicked !== null) {
              if (i === q.answer) variant = 'primary';
              else if (i === stressPicked) variant = 'danger';
            }
            return (
              <Button key={i} variant={variant} onPress={() => onPickStress(i)}>
                {t('fc_syllable_n', { n: i + 1 })}
              </Button>
            );
          })}
        </View>
      </>
    );
  }

  // type / listen — a typed-input question.
  const prompt = item.mode === 'listen' ? item.question.blanked : meaningOf(item.word);
  const hint = item.mode === 'listen' ? t('fc_listen_prompt') : t('fc_type_prompt');
  const correctWord = item.mode === 'listen' ? item.question.answer : item.word.word;
  return (
    <>
      <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
        <Title
          style={
            item.mode === 'listen'
              ? { ...th.text.lg, fontFamily: th.font.bodyBold, textAlign: 'center', maxWidth: 520 }
              : { ...th.text.xxl, fontFamily: th.font.displayBold, textAlign: 'center' }
          }
        >
          {prompt}
        </Title>
        <Muted>{hint}</Muted>
      </View>
      <View style={{ width: '100%', maxWidth: 420, gap: th.spacing[3] }}>
        <TextInput
          ref={inputRef}
          autoFocus={true}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          editable={typedVerdict === null}
          placeholder={t('fc_type_placeholder')}
          placeholderTextColor={th.color.textDisabled}
          value={typedInput}
          onChangeText={onTypedChange}
          onSubmitEditing={onSubmitTyped}
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
              typedVerdict === 'correct'
                ? th.status.success
                : typedVerdict === 'wrong'
                  ? th.status.danger
                  : th.color.borderStrong,
          }}
        />
        {typedVerdict === 'wrong' ? (
          <Text
            style={{
              fontFamily: th.font.bodyBold,
              color: th.color.textStrong,
              textAlign: 'center',
            }}
          >
            {t('fc_correct_was', { word: correctWord })}
          </Text>
        ) : (
          <Button
            block
            disabled={!typedInput.trim() || typedVerdict !== null}
            onPress={onSubmitTyped}
          >
            {t('fc_check')}
          </Button>
        )}
      </View>
    </>
  );
}

function McqOptions({
  options,
  answer,
  picked,
  onPick,
}: {
  options: string[];
  answer: string;
  picked: string | null;
  onPick: (opt: string) => void;
}) {
  return (
    <View style={{ width: '100%', maxWidth: 520, gap: 12 }}>
      {options.map((opt, i) => {
        let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
        if (picked) {
          if (opt === answer) variant = 'primary';
          else if (opt === picked) variant = 'danger';
        }
        return (
          <Button key={`${i}-${opt}`} variant={variant} block size="lg" onPress={() => onPick(opt)}>
            {opt}
          </Button>
        );
      })}
    </View>
  );
}

function imgStyle(th: ReturnType<typeof useTheme>) {
  return {
    width: 240,
    height: 240,
    borderRadius: th.radius.lg,
    borderWidth: 1,
    borderColor: th.color.borderSubtle,
    backgroundColor: th.color.surfaceCard,
  } as const;
}
