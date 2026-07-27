import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Volume2 } from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useInvalidateFlashcards, useTopic } from '~/lib/use-topics';
import { useWordAudio } from '~/lib/use-word-audio';
import { useTheme } from '~/theme';
import { Body, Button, IconButton, Input, Screen } from '~/ui';
import { ScreenHeader } from '~/components/ScreenHeader';

/**
 * Add or edit one word. **Staff only.** `id === 'new'` is the add case.
 *
 * A full screen rather than the web's `WordModal` — five fields plus a keyboard do not fit in a
 * modal on a 360dp screen.
 *
 * **Dictionary auto-fill and AI translation are deliberately not ported here.** On the web they
 * run in the browser against `dictionaryapi.dev` and `/translate`; a phone is a poor place to
 * curate vocabulary, and the flow (debounced lookup, partial fills, retry buttons) is the most
 * intricate part of the web screen. Staff who are authoring a topic should do it on a computer.
 * Mobile can add and correct words; bulk authoring stays on the web.
 */
export default function WordEditor() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const play = useWordAudio();
  const { slug, id } = useLocalSearchParams<{ slug: string; id: string }>();
  const isNew = id === 'new';

  const { bundle, loading, refetch } = useTopic(slug);
  const invalidate = useInvalidateFlashcards();
  const existing = bundle?.words.find((w) => w.id === id);

  const [word, setWord] = React.useState('');
  const [meaningVi, setMeaningVi] = React.useState('');
  const [definitionEn, setDefinitionEn] = React.useState('');
  const [ipa, setIpa] = React.useState('');
  const [hydrated, setHydrated] = React.useState(false);

  // Fill the form once the topic arrives. Guarded so a background refetch cannot overwrite what
  // the user has typed.
  React.useEffect(() => {
    if (hydrated || !existing) return;
    setWord(existing.word);
    setMeaningVi(existing.meaningVi);
    setDefinitionEn(existing.definitionEn ?? '');
    setIpa(existing.ipa ?? '');
    setHydrated(true);
  }, [existing, hydrated]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        word: word.trim(),
        meaningVi: meaningVi.trim(),
        // Empty strings become null, matching `preprocessWord` in the web's action.
        definitionEn: definitionEn.trim() || null,
        ipa: ipa.trim() || null,
        audioUrl: existing?.audioUrl ?? null,
      };
      if (isNew) {
        if (!bundle) throw new ApiError(0, 'no_topic', 'err_generic_msg');
        await api.flashcards.createWord(bundle.topic.id, payload);
      } else {
        await api.flashcards.updateWord(id, payload);
      }
    },
    onSuccess: async () => {
      await invalidate();
      refetch();
      router.back();
    },
  });

  if (user?.kind !== 'staff') {
    router.replace('/flashcards');
    return null;
  }

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={isNew ? t('fc_add_word') : t('fc_edit_word')}
        subtitle={bundle?.topic.name}
      />

      {!bundle && loading ? (
        <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        >
          <Input
            label={t('fc_word')}
            value={word}
            onChangeText={setWord}
            autoCapitalize="none"
            autoFocus={isNew}
            iconRight={
              <IconButton
                size="sm"
                label={t('fc_play_audio')}
                onPress={() => play(word, existing?.audioUrl)}
              >
                <Volume2 size={18} color={th.color.textMuted} />
              </IconButton>
            }
          />
          <Input label={t('fc_meaning_vi')} value={meaningVi} onChangeText={setMeaningVi} />
          <Input label={t('fc_ipa')} value={ipa} onChangeText={setIpa} autoCapitalize="none" />
          <Input
            label={t('fc_definition_en')}
            value={definitionEn}
            onChangeText={setDefinitionEn}
            multiline
            style={{ height: 80, textAlignVertical: 'top', paddingTop: 10 }}
          />

          {save.isError ? (
            <Body style={{ color: th.status.danger }}>
              {t(save.error instanceof ApiError ? save.error.messageKey : 'err_generic_msg')}
            </Body>
          ) : null}

          <View style={{ marginTop: th.spacing[2] }}>
            <Button
              block
              loading={save.isPending}
              disabled={!word.trim()}
              onPress={() => save.mutate()}
            >
              {t('save')}
            </Button>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
