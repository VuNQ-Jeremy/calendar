import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Sparkles, Volume2 } from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useInvalidateFlashcards, useTopic } from '~/lib/use-topics';
import { useWordAudio } from '~/lib/use-word-audio';
import { useTheme } from '~/theme';
import { Body, Button, IconButton, Input, Muted, Screen } from '~/ui';
import { ScreenHeader } from '~/components/ScreenHeader';

/**
 * Add or edit one word. **Staff only.** `id === 'new'` is the add case.
 *
 * A full screen rather than the web's `WordModal` — four fields plus a keyboard do not fit in a
 * modal on a 360dp screen.
 *
 * AI auto-fill matches the web: 500ms after the word field settles, Claude fills the meaning, IPA
 * and definition — but only the ones still blank, so anything typed by hand wins. The sparkle
 * button next to the meaning is the explicit retry, and it does overwrite the meaning. A server
 * with no `ANTHROPIC_API_KEY` answers 503 and the screen simply stays manual.
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

  // Latest field values, readable inside the async debounce without re-triggering it.
  const latest = React.useRef({ meaningVi, ipa, definitionEn });
  latest.current = { meaningVi, ipa, definitionEn };
  // Words already asked about, so the debounce fires once per spelling. Seeded with an existing
  // word's own spelling: opening a saved card must not call the API just to re-fill it.
  const lastFilled = React.useRef<string>('');
  React.useEffect(() => {
    if (existing && !lastFilled.current) lastFilled.current = existing.word.trim().toLowerCase();
  }, [existing]);

  /** Fill blanks from the model. `overwrite` is the explicit-retry case, which replaces the
   * meaning the user can see; IPA and definition are still only filled when blank. */
  const applyEnrichment = async (w: string, overwrite: boolean) => {
    const res = await api.enrichVocab([
      { word: w, definitionEn: latest.current.definitionEn || null },
    ]);
    const hit = res.words.find((x) => x.word.trim().toLowerCase() === w.toLowerCase());
    if (!hit) return;
    const meaningIsBlank = !latest.current.meaningVi.trim();
    if (hit.meaningVi && (overwrite || meaningIsBlank)) setMeaningVi(hit.meaningVi);
    if (hit.ipa && !latest.current.ipa) setIpa(hit.ipa);
    if (hit.definitionEn && !latest.current.definitionEn) setDefinitionEn(hit.definitionEn);
  };

  const enrich = useMutation({
    mutationFn: ({ w, overwrite }: { w: string; overwrite: boolean }) =>
      applyEnrichment(w, overwrite),
  });
  // A server with no ANTHROPIC_API_KEY answers 503 `disabled` on every keystroke's lookup. That is
  // configuration, not a failure the author can act on, so it stays silent.
  const enrichFailedVisibly =
    enrich.isError && !(enrich.error instanceof ApiError && enrich.error.code === 'disabled');

  React.useEffect(() => {
    const w = word.trim();
    const key = w.toLowerCase();
    if (!w || key === lastFilled.current) return;
    const handle = setTimeout(() => {
      lastFilled.current = key;
      enrich.mutate({ w, overwrite: false });
    }, 500);
    return () => clearTimeout(handle);
    // `enrich` is a stable mutation object; depending on it would restart the timer every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        word: word.trim(),
        meaningVi: meaningVi.trim(),
        // Empty strings become null, matching `preprocessWord` in the web's action.
        definitionEn: definitionEn.trim() || null,
        ipa: ipa.trim() || null,
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
    router.replace('/vocabulary');
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
              <IconButton size="sm" label={t('fc_play_audio')} onPress={() => play(word)}>
                <Volume2 size={18} color={th.color.textMuted} />
              </IconButton>
            }
          />
          {enrich.isPending ? <Muted>{t('fc_enriching')}</Muted> : null}
          {enrichFailedVisibly ? (
            <Body style={{ color: th.status.warning }}>{t('fc_enrich_failed')}</Body>
          ) : null}
          <Input
            label={t('fc_meaning_vi')}
            value={meaningVi}
            onChangeText={setMeaningVi}
            iconRight={
              <IconButton
                size="sm"
                label={t('fc_enrich')}
                disabled={!word.trim() || enrich.isPending}
                onPress={() => enrich.mutate({ w: word.trim(), overwrite: true })}
              >
                <Sparkles size={18} color={th.color.textMuted} />
              </IconButton>
            }
          />
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
