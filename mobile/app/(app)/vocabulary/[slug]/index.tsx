import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Grid3x3,
  Layers,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { MIN_WORDS } from '@mochi/shared/logic/flashcards';
import type { GameMode } from '@mochi/shared/logic/flashcards';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { agoLabel } from '~/lib/format';
import { useInvalidateFlashcards, usePendingSync, useTopic } from '~/lib/use-topics';
import { useWordAudio } from '~/lib/use-word-audio';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, IconButton, Mono, Muted, Screen, Tabs } from '~/ui';
import { OfflineBanner } from '~/ui/OfflineBanner';
import { ScreenHeader } from '~/components/ScreenHeader';
import { ResultsTab } from '~/components/ResultsTab';
import type { FlashcardWordRow } from '~/lib/types';

/**
 * Port of the Words/Results half of `src/flashcards/topic.tsx`.
 *
 * The web file is 856 lines and bundles four concerns (this screen, the word modal, the import
 * modal, and the game overlay). Here they are four routes — the plan's instruction was to split
 * it rather than reproduce the monolith.
 */

const MODES: { id: GameMode; tk: string; Icon: typeof Layers }[] = [
  { id: 'flip', tk: 'fc_mode_flip', Icon: Layers },
  { id: 'quiz', tk: 'fc_mode_quiz', Icon: ListChecks },
  { id: 'match', tk: 'fc_mode_match', Icon: Grid3x3 },
];

export default function TopicScreen() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const isStaff = user?.kind === 'staff';
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const { bundle, loading, unavailableOffline, syncedAt, refetch } = useTopic(slug);
  const pending = usePendingSync();
  const invalidate = useInvalidateFlashcards();
  const [tab, setTab] = React.useState('words');

  const words = bundle?.words ?? [];

  const removeWord = useMutation({
    mutationFn: (id: string) => api.flashcards.removeWord(id),
    onSuccess: async () => {
      await invalidate();
      refetch();
    },
  });

  // A topic that was never downloaded, opened with no connection. This is a dead end, so it says
  // so — a spinner that never resolves is the worst possible answer here.
  if (unavailableOffline) {
    return (
      <Screen edges={{ top: true }}>
        <ScreenHeader title={t('fc_title')} />
        <View style={{ padding: th.spacing[6], gap: th.spacing[3] }}>
          <Heading>{t('m_not_offline')}</Heading>
          <Muted>{t('m_not_offline_sub')}</Muted>
          <Button variant="secondary" onPress={refetch}>
            {t('m_retry')}
          </Button>
        </View>
      </Screen>
    );
  }

  if (!bundle) {
    return (
      <Screen edges={{ top: true }}>
        <ScreenHeader title={t('fc_title')} />
        {loading ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
        ) : (
          <View style={{ padding: th.spacing[6], gap: th.spacing[3] }}>
            <Muted>{t('fc_not_found')}</Muted>
            <Button variant="secondary" onPress={refetch}>
              {t('m_retry')}
            </Button>
          </View>
        )}
      </Screen>
    );
  }

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={bundle.topic.name}
        subtitle={
          syncedAt
            ? `${t('fc_word_count', { n: words.length })} · ${t('m_synced_ago', { ago: agoLabel(t, syncedAt) })}`
            : t('fc_word_count', { n: words.length })
        }
      />
      <OfflineBanner pending={pending} />

      <View style={{ padding: th.spacing[4], gap: th.spacing[4] }}>
        {/* Game launchers. A mode with too few words is disabled, same thresholds as the web. */}
        <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
          {MODES.map(({ id, tk, Icon }) => {
            const disabled = words.length < MIN_WORDS[id];
            return (
              <Button
                key={id}
                variant="soft"
                style={{ flex: 1 }}
                disabled={disabled}
                iconLeft={<Icon size={16} color={th.color.brandSoftInk} />}
                onPress={() => router.push(`/play/${encodeURIComponent(slug)}/${id}`)}
              >
                {t(tk)}
              </Button>
            );
          })}
        </View>

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'words', label: t('fc_tab_words') },
            { id: 'results', label: t('fc_tab_results') },
          ]}
        />
      </View>

      {tab === 'words' ? (
        <WordsTab
          slug={slug}
          words={words}
          isStaff={isStaff}
          onDelete={(id) => removeWord.mutate(id)}
        />
      ) : (
        <ResultsTab results={bundle.results} />
      )}
    </Screen>
  );
}

/**
 * The word list. `FlashList`, not a ScrollView — a topic holds up to 200 words and a plain
 * ScrollView renders every row up front.
 */
function WordsTab({
  slug,
  words,
  isStaff,
  onDelete,
}: {
  slug: string;
  words: FlashcardWordRow[];
  isStaff: boolean;
  onDelete: (id: string) => void;
}) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();

  return (
    <FlashList
      data={words}
      keyExtractor={(w) => w.id}
      contentContainerStyle={{ paddingHorizontal: th.spacing[4], paddingBottom: th.spacing[10] }}
      ListHeaderComponent={
        isStaff ? (
          <View style={{ flexDirection: 'row', gap: th.spacing[2], marginBottom: th.spacing[3] }}>
            <Button
              style={{ flex: 1 }}
              iconLeft={<Plus size={16} color={th.color.textOnBrand} />}
              onPress={() => router.push(`/vocabulary/${encodeURIComponent(slug)}/word/new`)}
            >
              {t('fc_add_word')}
            </Button>
            <Button
              variant="secondary"
              style={{ flex: 1 }}
              iconLeft={<Upload size={16} color={th.color.textStrong} />}
              onPress={() => router.push(`/vocabulary/${encodeURIComponent(slug)}/import`)}
            >
              {t('fc_import')}
            </Button>
          </View>
        ) : null
      }
      ListEmptyComponent={
        <Card>
          <Heading>{t('fc_no_words')}</Heading>
          {isStaff ? <Muted>{t('fc_no_words_sub')}</Muted> : null}
        </Card>
      }
      renderItem={({ item: w }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: th.spacing[2],
            paddingVertical: th.spacing[2],
            borderBottomWidth: 1,
            borderBottomColor: th.color.borderSubtle,
          }}
        >
          <IconButton size="sm" label={t('fc_play_audio')} onPress={() => play(w.word, w.audioUrl)}>
            <Volume2 size={18} color={th.color.textMuted} />
          </IconButton>

          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', gap: th.spacing[2], alignItems: 'baseline' }}>
              <Body style={{ fontFamily: th.font.bodyBold }}>{w.word}</Body>
              {w.ipa ? <Mono>{w.ipa}</Mono> : null}
            </View>
            {w.meaningVi ? <Body style={{ ...th.text.sm }}>{w.meaningVi}</Body> : null}
            {w.definitionEn ? <Muted numberOfLines={2}>{w.definitionEn}</Muted> : null}
          </View>

          {isStaff ? (
            <>
              <IconButton
                size="sm"
                label={t('edit')}
                onPress={() =>
                  router.push(`/vocabulary/${encodeURIComponent(slug)}/word/${w.id}`)
                }
              >
                <Pencil size={16} color={th.color.textMuted} />
              </IconButton>
              <IconButton size="sm" label={t('delete')} onPress={() => onDelete(w.id)}>
                <Trash2 size={16} color={th.status.danger} />
              </IconButton>
            </>
          ) : null}
        </View>
      )}
    />
  );
}

