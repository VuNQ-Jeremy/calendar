import React from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { parseImportLines } from '@mochi/shared/logic/flashcards';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useInvalidateFlashcards, useTopic } from '~/lib/use-topics';
import { useTheme } from '~/theme';
import { Body, Button, Card, Checkbox, Input, Muted, Screen } from '~/ui';
import { ScreenHeader } from '~/components/ScreenHeader';

/**
 * Bulk paste. **Staff only.** Port of the web's `ImportModal`, minus the dictionary and AI passes.
 *
 * The parser is `parseImportLines` from `@mochi/shared/logic/flashcards` — the same function the
 * web uses, so `word<TAB>nghĩa` and `word - nghĩa` behave identically on both, including the
 * detail that the spaces around the dash are what let `well-known` through unsplit.
 *
 * The web enriches each row from dictionaryapi.dev and can AI-translate the blanks. Neither is
 * ported: they are a curation workflow that belongs on a keyboard, and the import endpoint is
 * happy with word/meaning pairs alone. Rows can still be unticked before sending.
 */

/** Server-side cap, from `FlashcardImportInput`. Enforced here so the 422 never happens. */
const MAX_WORDS = 200;

export default function ImportWords() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { bundle, refetch } = useTopic(slug);
  const invalidate = useInvalidateFlashcards();

  const [step, setStep] = React.useState<'paste' | 'review'>('paste');
  const [text, setText] = React.useState('');
  const [rows, setRows] = React.useState<{ word: string; meaningVi: string; include: boolean }[]>(
    [],
  );

  const included = rows.filter((r) => r.include && r.word.trim());

  const submit = useMutation({
    mutationFn: async () => {
      if (!bundle) throw new ApiError(0, 'no_topic', 'err_generic_msg');
      await api.flashcards.importWords(bundle.topic.id, {
        words: included.slice(0, MAX_WORDS).map((r) => ({
          word: r.word.trim(),
          meaningVi: r.meaningVi.trim(),
          definitionEn: null,
          ipa: null,
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
    router.replace('/flashcards');
    return null;
  }

  const review = () => {
    const parsed = parseImportLines(text);
    if (parsed.length === 0) return;
    setRows(parsed.map((p) => ({ ...p, include: true })));
    setStep('review');
  };

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
            <Button block disabled={!text.trim()} onPress={review}>
              {t('auth_continue')}
            </Button>
          </>
        ) : (
          <>
            <Muted>{t('fc_import_n', { n: included.length })}</Muted>

            {rows.map((r, i) => (
              <Card key={`${i}-${r.word}`} flat style={{ gap: th.spacing[2], opacity: r.include ? 1 : 0.5 }}>
                <Checkbox
                  checked={r.include}
                  label={r.word}
                  onChange={(v) =>
                    setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, include: v } : x)))
                  }
                />
                <Input
                  placeholder={t('fc_meaning_vi')}
                  value={r.meaningVi}
                  onChangeText={(v) =>
                    setRows((rs) =>
                      rs.map((x, idx) => (idx === i ? { ...x, meaningVi: v } : x)),
                    )
                  }
                />
              </Card>
            ))}

            {included.length > MAX_WORDS ? (
              <Body style={{ color: th.status.warning }}>
                {t('fc_import_n', { n: MAX_WORDS })}
              </Body>
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
