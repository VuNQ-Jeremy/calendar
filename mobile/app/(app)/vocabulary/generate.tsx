import React from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { VOCAB_TOPICS, vocabTopicLabel } from '@mochi/shared/logic/vocab-topics';
import type { VocabLevel } from '@mochi/shared/schemas';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useInvalidateFlashcards } from '~/lib/use-topics';
import { useTheme } from '~/theme';
import { Body, Button, Card, Checkbox, Input, Mono, Muted, Screen } from '~/ui';
import { ScreenHeader } from '~/components/ScreenHeader';

/**
 * Create a whole topic from a name. **Staff only.** Sibling of `new.tsx` (the manual form) and the
 * port of the web's `GenerateTopicModal`: pick a topic, let the model write the words, review, save.
 *
 * This is the only AI-generation entry point — an existing topic grows by hand or by paste import.
 */

/** Server-side cap, from `VocabGenerateInput`. */
const MAX_COUNT = 50;

const LEVELS: ('any' | VocabLevel)[] = ['any', 'beginner', 'intermediate', 'advanced'];

type GenRow = {
  word: string;
  meaningVi: string;
  definitionEn: string;
  ipa: string;
  include: boolean;
};

export default function GenerateTopic() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { user } = useAuth();
  const invalidate = useInvalidateFlashcards();

  const [step, setStep] = React.useState<'setup' | 'review'>('setup');
  // The picker fills this in rather than hiding a second value: `name` is both what the topic is
  // called and what the model is asked for, and it stays editable either way.
  const [name, setName] = React.useState('');
  const [count, setCount] = React.useState('20');
  const [level, setLevel] = React.useState<'any' | VocabLevel>('any');
  const [rows, setRows] = React.useState<GenRow[]>([]);

  const included = rows.filter((r) => r.include && r.word.trim());

  const generate = useMutation({
    mutationFn: () =>
      api.generateVocab({
        topic: name.trim(),
        count: Math.min(Math.max(parseInt(count, 10) || 20, 1), MAX_COUNT),
        level: level === 'any' ? null : level,
        exclude: [],
      }),
    onSuccess: (res) => {
      setRows(
        res.words.map((w) => ({
          word: w.word,
          meaningVi: w.meaningVi,
          definitionEn: w.definitionEn ?? '',
          ipa: w.ipa ?? '',
          include: true,
        })),
      );
      if (res.words.length > 0) setStep('review');
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api.flashcards.createTopicWithWords({
        name: name.trim(),
        description: null,
        color: 'violet',
        words: included.map((r) => ({
          word: r.word.trim(),
          meaningVi: r.meaningVi.trim(),
          definitionEn: r.definitionEn.trim() || null,
          ipa: r.ipa.trim() || null,
          audioUrl: null,
        })),
      }),
    onSuccess: async (topic) => {
      await invalidate();
      // Replace, not push: the setup screen has served its purpose and back should go to the list.
      router.replace(`/vocabulary/${encodeURIComponent(topic.slug ?? topic.id)}`);
    },
  });

  if (user?.kind !== 'staff') {
    router.replace('/vocabulary');
    return null;
  }

  const generateErrorKey =
    generate.error instanceof ApiError
      ? generate.error.code === 'disabled'
        ? 'fc_gen_disabled'
        : generate.error.messageKey
      : 'fc_gen_failed';

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('fc_gen_new_title')} />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
      >
        {step === 'setup' ? (
          <>
            <Muted>{t('fc_gen_topic_pick')}</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
              {VOCAB_TOPICS.map((vt) => (
                <Button
                  key={vt.id}
                  variant={name === vt.en ? 'primary' : 'secondary'}
                  onPress={() => setName(vt.en)}
                >
                  {vocabTopicLabel(vt, lang)}
                </Button>
              ))}
            </View>

            <Input label={t('fc_topic_name')} value={name} onChangeText={setName} />
            <Input
              label={t('fc_gen_count')}
              value={count}
              onChangeText={setCount}
              keyboardType="number-pad"
            />

            <Muted>{t('fc_gen_level')}</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
              {LEVELS.map((l) => (
                <Button
                  key={l}
                  variant={level === l ? 'primary' : 'secondary'}
                  onPress={() => setLevel(l)}
                >
                  {t(`fc_gen_level_${l}`)}
                </Button>
              ))}
            </View>

            <Muted>{generate.isPending ? t('fc_gen_wait') : t('fc_gen_new_hint')}</Muted>

            {generate.isError ? (
              <Body style={{ color: th.status.danger }}>{t(generateErrorKey)}</Body>
            ) : null}
            {generate.isSuccess && rows.length === 0 ? (
              <Body style={{ color: th.status.warning }}>{t('fc_gen_empty')}</Body>
            ) : null}

            <Button
              block
              loading={generate.isPending}
              disabled={!name.trim()}
              onPress={() => generate.mutate()}
            >
              {generate.isPending ? t('fc_gen_running') : t('fc_gen_run')}
            </Button>
          </>
        ) : (
          <>
            <Muted>{t('fc_gen_new_save', { n: included.length })}</Muted>

            {rows.map((r, i) => (
              <Card
                key={`${i}-${r.word}`}
                flat
                style={{ gap: th.spacing[2], opacity: r.include ? 1 : 0.5 }}
              >
                <Checkbox
                  checked={r.include}
                  label={r.word}
                  onChange={(v) =>
                    setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, include: v } : x)))
                  }
                />
                {r.ipa ? <Mono>{r.ipa}</Mono> : null}
                {r.definitionEn ? <Muted numberOfLines={2}>{r.definitionEn}</Muted> : null}
                <Input
                  placeholder={t('fc_meaning_vi')}
                  value={r.meaningVi}
                  onChangeText={(v) =>
                    setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, meaningVi: v } : x)))
                  }
                />
              </Card>
            ))}

            {save.isError ? (
              <Body style={{ color: th.status.danger }}>
                {t(save.error instanceof ApiError ? save.error.messageKey : 'err_generic_msg')}
              </Body>
            ) : null}

            <View style={{ gap: th.spacing[3] }}>
              <Button
                block
                loading={save.isPending}
                disabled={included.length === 0}
                onPress={() => save.mutate()}
              >
                {t('fc_gen_new_save', { n: included.length })}
              </Button>
              <Button variant="ghost" block onPress={() => setStep('setup')}>
                {t('cancel')}
              </Button>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
