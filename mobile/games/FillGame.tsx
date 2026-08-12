import React from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  decoyLetters,
  maskWord,
  meaningOf,
  pickRound,
  shuffle,
  SPELL_ROUND_SIZE,
} from '@mochi/shared/logic/flashcards';
import type { MaskSlot } from '@mochi/shared/logic/flashcards';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Muted, Title } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-fill.tsx`. The word with 40% of its letters hidden, the meaning as
 * the hint; the bank is the hidden letters plus two decoys. Same masking, same one-attempt
 * grading, same reveal delays as the web.
 */

type Question = { word: FlashcardWordRow; slots: MaskSlot[]; bank: string[] };

function buildQuestions(words: FlashcardWordRow[], roundSize?: number): Question[] {
  return pickRound(words, roundSize ?? SPELL_ROUND_SIZE).map((w) => {
    const slots = maskWord(w.word);
    const hidden = slots.filter((s) => s.hidden).map((s) => s.ch);
    return { word: w, slots, bank: shuffle([...hidden, ...decoyLetters(2)]) };
  });
}

export function FillGame({ words, roundSize, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
  const { t } = useLang();

  const gapCount = (q: Question | undefined) => q?.slots.filter((s) => s.hidden).length ?? 0;
  const [questions, setQuestions] = React.useState<Question[]>(() =>
    buildQuestions(words, roundSize),
  );
  const [idx, setIdx] = React.useState(0);
  const [placed, setPlaced] = React.useState<(number | null)[]>(() =>
    Array(gapCount(questions[0])).fill(null),
  );
  const [verdict, setVerdict] = React.useState<'correct' | 'wrong' | null>(null);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const done = idx >= questions.length;
  const score = answers.filter((a) => a.correct).length;
  const q = questions[idx];

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({
        mode: 'fill',
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
    setVerdict(null);
    setPlaced(Array(gapCount(questions[idx + 1])).fill(null));
    setIdx((i) => i + 1);
  };

  const grade = (next: (number | null)[]) => {
    let gap = -1;
    const built = q.slots
      .map((s) => {
        if (!s.hidden) return s.ch;
        gap += 1;
        const bankIdx = next[gap];
        return bankIdx === null ? '' : q.bank[bankIdx];
      })
      .join('');
    const correct = built.toLowerCase() === q.word.word.toLowerCase();
    setVerdict(correct ? 'correct' : 'wrong');
    setAnswers((a) => [...a, { wordId: q.word.id, correct }]);
    timer.current = setTimeout(advance, correct ? 700 : 1600);
  };

  const tapBank = (bankIdx: number) => {
    if (verdict || placed.includes(bankIdx)) return;
    const at = placed.indexOf(null);
    if (at < 0) return;
    const next = placed.slice();
    next[at] = bankIdx;
    setPlaced(next);
    if (!next.includes(null)) grade(next);
  };

  const tapGap = (gapOrdinal: number) => {
    if (verdict) return;
    setPlaced((p) => {
      const next = p.slice();
      next[gapOrdinal] = null;
      return next;
    });
  };

  const replay = () => {
    finished.current = false;
    const qs = buildQuestions(words, roundSize);
    setQuestions(qs);
    setAnswers([]);
    setIdx(0);
    setPlaced(Array(gapCount(qs[0])).fill(null));
    setVerdict(null);
    started.current = Date.now();
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

  let gapOrdinal = -1;
  const used = new Set(placed.filter((v): v is number => v !== null));

  const tileBase = {
    minWidth: 40,
    height: 48,
    paddingHorizontal: th.spacing[2],
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: th.radius.md,
  };
  const tileText = {
    fontFamily: th.font.bodyBold,
    fontSize: th.text.lg.fontSize,
    color: th.color.textStrong,
  };

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: th.spacing[5],
        padding: th.spacing[5],
      }}
    >
      <Muted style={{ fontFamily: th.font.bodyBold }}>
        {t('fc_question_of', { i: idx + 1, n: questions.length })} · {t('fc_score')}: {score}
      </Muted>

      <View style={{ alignItems: 'center', gap: th.spacing[2] }}>
        <Title style={{ ...th.text.xl, fontFamily: th.font.displayBold, textAlign: 'center' }}>
          {meaningOf(q.word)}
        </Title>
        <Muted>{t('fc_fill_hint')}</Muted>
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: th.spacing[2],
          justifyContent: 'center',
          maxWidth: 520,
        }}
      >
        {q.slots.map((s, i) => {
          if (!s.hidden) {
            return (
              <View key={i} style={{ ...tileBase, minWidth: s.ch === ' ' ? 16 : 24 }}>
                <Text style={tileText}>{s.ch}</Text>
              </View>
            );
          }
          gapOrdinal += 1;
          const at = gapOrdinal;
          const bankIdx = placed[at];
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              onPress={() => tapGap(at)}
              style={{
                ...tileBase,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor:
                  verdict === 'correct'
                    ? th.status.success
                    : verdict === 'wrong'
                      ? th.status.danger
                      : th.color.borderSubtle,
                backgroundColor:
                  verdict === 'correct'
                    ? th.category.green.soft
                    : verdict === 'wrong'
                      ? th.category.rose.soft
                      : th.color.surfaceCard,
              }}
            >
              <Text style={tileText}>{bankIdx === null ? '' : q.bank[bankIdx]}</Text>
            </Pressable>
          );
        })}
      </View>

      {verdict === 'wrong' ? (
        <Text style={{ fontFamily: th.font.bodyBold, color: th.color.textStrong }}>
          {t('fc_correct_was', { word: q.word.word })}
        </Text>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: th.spacing[2],
          justifyContent: 'center',
          maxWidth: 520,
        }}
      >
        {q.bank.map((ch, i) => {
          const isUsed = used.has(i);
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityState={{ disabled: isUsed }}
              disabled={isUsed || verdict !== null}
              onPress={() => tapBank(i)}
              style={{
                ...tileBase,
                borderWidth: 1.5,
                borderColor: th.color.borderSubtle,
                backgroundColor: th.color.surfaceCard,
                opacity: isUsed ? 0.25 : 1,
              }}
            >
              <Text style={tileText}>{ch}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
