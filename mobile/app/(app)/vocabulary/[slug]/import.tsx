import React from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { parseImportLines } from '@mochi/shared/logic/flashcards';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { enrichInChunks } from '~/lib/enrich';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useInvalidateFlashcards, useTopic } from '~/lib/use-topics';
import { useTheme } from '~/theme';
import { Body, Button, Card, Checkbox, Input, Mono, Muted, Screen } from '~/ui';
import { ScreenHeader } from '~/components/ScreenHeader';

/**
 * Bulk paste. **Staff only.** Port of the web's `ImportModal`.
 *
 * The parser is `parseImportLines` from `@mochi/shared/logic/flashcards` — the same function the
 * web uses, so `word<TAB>nghĩa` and `word - nghĩa` behave identically on both, including the
 * detail that the spaces around the dash are what let `well-known` through unsplit.
 *
 * Continuing from the paste step asks Claude to fill in the meaning, IPA and definition for every
 * pasted word (`/enrich-vocab`, in 50-word chunks). That pass used to be web-only, when it ran
 * against dictionaryapi.dev from the browser. If it fails — or the server has no API key — the
 * review step still opens with the raw rows, which is what this screen has always offered.
 */

/** Server-side cap, from `FlashcardImportInput`. Enforced here so the 422 never happens. */
const MAX_WORDS = 200;

type Row = {
  word: string;
  meaningVi: string;
  ipa: string;
  definitionEn: string;
  include: boolean;
};

export default function ImportWords() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { bundle, refetch } = useTopic(slug);
  const invalidate = useInvalidateFlashcards();

  const [step, setStep] = React.useState<'paste' | 'review'>('paste');
  const [text, setText] = React.useState('');
  const [rows, setRows] = React.useState<Row[]>([]);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);

  const included = rows.filter((r) => r.include && r.word.trim());
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  // Paste → enrich → review. A failed enrich still advances: the fields are editable by hand.
  const enrich = useMutation({
    mutationFn: async () => {
      const parsed = parseImportLines(text);
      if (parsed.length === 0) return;
      // One request per distinct word. Rows the user glossed inline still get IPA and definition,
      // so they are not skipped here.
      const seen = new Set<string>();
      const items = parsed
        .filter((p) => {
          const key = p.word.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((p) => ({ word: p.word }));
      let map;
      try {
        setProgress({ done: 0, total: items.length });
        map = await enrichInChunks(items, (done, total) => setProgress({ done, total }));
      } finally {
        setProgress(null);
      }
      return map;
    },
    // Both paths open the review step; onError just means the AI columns stay blank.
    onSuccess: (map) => {
      const parsed = parseImportLines(text);
      if (parsed.length === 0) return;
      setRows(
        parsed.map((p) => {
          const hit = map?.get(p.word.toLowerCase());
          return {
            word: p.word,
            // A typed meaning always wins over the model's.
            meaningVi: p.meaningVi || hit?.meaningVi || '',
            ipa: hit?.ipa ?? '',
            definitionEn: hit?.definitionEn ?? '',
            include: true,
          };
        }),
      );
      setStep('review');
    },
    onError: () => {
      setRows(
        parseImportLines(text).map((p) => ({
          word: p.word,
          meaningVi: p.meaningVi,
          ipa: '',
          definitionEn: '',
          include: true,
        })),
      );
      setStep('review');
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!bundle) throw new ApiError(0, 'no_topic', 'err_generic_msg');
      await api.flashcards.importWords(bundle.topic.id, {
        words: included.slice(0, MAX_WORDS).map((r) => ({
          word: r.word.trim(),
          meaningVi: r.meaningVi.trim(),
          definitionEn: r.definitionEn.trim() || null,
          ipa: r.ipa.trim() || null,
          // Imported words arrive untagged; the catalog tags are applied on the web.
          topicIds: [],
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

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('fc_import_title')} subtitle={bundle?.topic.name} />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
      >
        {step === 'paste' ? (
          <>
            <Input
              label={t('fc_import')}
              hint={t('fc_import_hint')}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              style={{ height: 220, textAlignVertical: 'top', paddingTop: 10 }}
            />
            <Muted>{t('fc_enrich_hint')}</Muted>
            <Button
              block
              loading={enrich.isPending}
              disabled={!text.trim()}
              onPress={() => enrich.mutate()}
            >
              {progress ? `${progress.done}/${progress.total}` : t('fc_enrich')}
            </Button>
          </>
        ) : (
          <>
            <Muted>{t('fc_import_n', { n: included.length })}</Muted>

            {enrich.isError ? (
              <Body style={{ color: th.status.warning }}>{t('fc_enrich_failed')}</Body>
            ) : null}

            {rows.map((r, i) => (
              <Card
                key={`${i}-${r.word}`}
                flat
                style={{ gap: th.spacing[2], opacity: r.include ? 1 : 0.5 }}
              >
                <Checkbox
                  checked={r.include}
                  label={r.word}
                  onChange={(v) => setRow(i, { include: v })}
                />
                {r.ipa ? <Mono>{r.ipa}</Mono> : null}
                {r.definitionEn ? <Muted>{r.definitionEn}</Muted> : null}
                <Input
                  placeholder={t('fc_meaning_vi')}
                  value={r.meaningVi}
                  onChangeText={(v) => setRow(i, { meaningVi: v })}
                />
              </Card>
            ))}

            {included.length > MAX_WORDS ? (
              <Body style={{ color: th.status.warning }}>{t('fc_import_n', { n: MAX_WORDS })}</Body>
            ) : null}

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
                {t('fc_import_n', { n: Math.min(included.length, MAX_WORDS) })}
              </Button>
              <Button variant="ghost" block onPress={() => setStep('paste')}>
                {t('cancel')}
              </Button>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
