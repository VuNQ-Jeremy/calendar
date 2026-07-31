import React from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { VOCAB_TOPICS, vocabTopicLabel } from '@mochi/shared/logic/vocab-topics';
import type { VocabLevel } from '@mochi/shared/schemas';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useInvalidateFlashcards, useTopic } from '~/lib/use-topics';
import { useTheme } from '~/theme';
import { Body, Button, Card, Checkbox, Input, Mono, Muted, Screen } from '~/ui';
import { ScreenHeader } from '~/components/ScreenHeader';

/**
 * AI vocabulary generation. **Staff only.** Sibling of `import.tsx` and port of the web's
 * `GenerateModal`: pick a topic, let the model propose words, review the list, then save the
 * kept ones through the same import endpoint.
 *
 * The topic list is `VOCAB_TOPICS` from shared, so both clients offer the same choices; `custom`
 * falls back to a free-text field for anything not in the catalog. Generation needs the network
 * by definition, so there is no offline path here beyond the `bundle` guards.
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

export default function GenerateWords() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { bundle, refetch } = useTopic(slug);
  const invalidate = useInvalidateFlashcards();

  const [step, setStep] = React.useState<'setup' | 'review'>('setup');
  const [topicId, setTopicId] = React.useState('');
  const [customTopic, setCustomTopic] = React.useState('');
  const [count, setCount] = React.useState('20');
  const [level, setLevel] = React.useState<'any' | VocabLevel>('any');
  const [rows, setRows] = React.useState<GenRow[]>([]);

  // The model always gets the English name; the `vi` labels are display only.
  const topic =
    topicId === 'custom'
      ? customTopic.trim()
      : (VOCAB_TOPICS.find((vt) => vt.id === topicId)?.en ?? '');
  const included = rows.filter((r) => r.include && r.word.trim());

  const generate = useMutation({
    mutationFn: async () => {
      if (!bundle) throw new ApiError(0, 'no_topic', 'err_generic_msg');
      return api.generateVocab({
        topic,
        count: Math.min(Math.max(parseInt(count, 10) || 20, 1), MAX_COUNT),
        level: level === 'any' ? null : level,
        // Words already in the deck, so the model does not propose them again.
        exclude: bundle.words.map((w) => w.word).slice(0, 500),
      });
    },
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

  const submit = useMutation({
    mutationFn: async () => {
      if (!bundle) throw new ApiError(0, 'no_topic', 'err_generic_msg');
      await api.flashcards.importWords(bundle.topic.id, {
        words: included.map((r) => ({
          word: r.word.trim(),
          meaningVi: r.meaningVi.trim(),
          definitionEn: r.definitionEn.trim() || null,
          ipa: r.ipa.trim() || null,
          audioUrl: null,
        })),
      });
    },
    onSuccess: async () => {
      await invalidate();
      refetch();
      router.back();
    },
  });

  if (user?.kind !== 'staff') {
    router.replace('/vocabulary');
    return null;
  }

  // A 503 means the server has no ANTHROPIC_API_KEY — worth its own message, since retrying
  // will never help. Everything else uses the ApiError's own message key.
  const generateErrorKey =
    generate.error instanceof ApiError
      ? generate.error.code === 'disabled'
        ? 'fc_gen_disabled'
        : generate.error.messageKey
      : 'fc_gen_failed';

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('fc_gen_title')} subtitle={bundle?.topic.name} />

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
                  variant={topicId === vt.id ? 'primary' : 'secondary'}
                  onPress={() => setTopicId(vt.id)}
                >
                  {vocabTopicLabel(vt, lang)}
                </Button>
              ))}
              <Button
                variant={topicId === 'custom' ? 'primary' : 'secondary'}
                onPress={() => setTopicId('custom')}
              >
                {t('fc_gen_topic_custom')}
              </Button>
            </View>

            {topicId === 'custom' ? (
              <Input
                label={t('fc_gen_topic')}
                value={customTopic}
                onChangeText={setCustomTopic}
                autoFocus
              />
            ) : null}

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

            <Muted>{generate.isPending ? t('fc_gen_wait') : t('fc_gen_hint')}</Muted>

            {generate.isError ? (
              <Body style={{ color: th.status.danger }}>{t(generateErrorKey)}</Body>
            ) : null}
            {generate.isSuccess && rows.length === 0 ? (
              <Body style={{ color: th.status.warning }}>{t('fc_gen_empty')}</Body>
            ) : null}

            <Button
              block
              loading={generate.isPending}
              disabled={!topic}
              onPress={() => generate.mutate()}
            >
              {generate.isPending ? t('fc_gen_running') : t('fc_gen_run')}
            </Button>
          </>
        ) : (
          <>
            <Muted>{t('fc_gen_save', { n: included.length })}</Muted>

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

            {submit.isError ? (
              <Body style={{ color: th.status.danger }}>
                {t(submit.error instanceof ApiError ? submit.error.messageKey : 'err_generic_msg')}
              </Body>
            ) : null}

            <View style={{ gap: th.spacing[3] }}>
              <Button
                block
                loading={submit.isPending}
                disabled={included.length === 0}
                onPress={() => submit.mutate()}
              >
                {t('fc_gen_save', { n: included.length })}
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
