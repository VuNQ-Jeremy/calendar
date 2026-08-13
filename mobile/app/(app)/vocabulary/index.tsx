import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Check, CloudDownload, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { GardenWidget } from '~/components/garden/GardenWidget';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { agoLabel } from '~/lib/format';
import * as api from '~/lib/endpoints';
import {
  useDownloaded,
  useInvalidateFlashcards,
  usePendingSync,
  useTopicDownload,
  useTopics,
} from '~/lib/use-topics';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, IconButton, Mono, Muted, Screen, Title } from '~/ui';
import { OfflineBanner } from '~/ui/OfflineBanner';
import type { ColorIdKey } from '@mochi/shared/tokens';
import type { FlashcardTopicRow } from '~/lib/types';

/**
 * Port of `src/flashcards/index.tsx` — the topic grid, one card per topic.
 *
 * Mobile-only addition: a per-topic download toggle. Topics are a few KB each, but the decision
 * to spend mobile data is the student's, not ours — so nothing downloads on its own.
 */
export default function FlashcardTopics() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const isStaff = user?.kind === 'staff';

  const { data: topics, isLoading, isRefetching, refetch, error } = useTopics();
  const { map: downloaded, reload } = useDownloaded();
  const { download, remove } = useTopicDownload(reload);
  const pending = usePendingSync();
  const invalidate = useInvalidateFlashcards();

  const del = useMutation({
    mutationFn: (id: string) => api.flashcards.removeTopic(id),
    onSuccess: () => void invalidate(),
  });

  const open = (topic: FlashcardTopicRow) =>
    router.push(`/vocabulary/${encodeURIComponent(topic.slug ?? topic.id)}`);

  return (
    <Screen edges={{ top: true }}>
      <OfflineBanner pending={pending} />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={th.color.brand}
          />
        }
      >
        <View style={{ gap: th.spacing[1] }}>
          <Title>{t('fc_title')}</Title>
          <Muted>{t('fc_subtitle')}</Muted>
        </View>

        {/* The student's plant, where the web puts it: above the topics, because it is the reason
            to open one. Staff have no plant — they tend the garden from the web. */}
        {isStaff ? null : <GardenWidget />}

        {isStaff ? (
          <View style={{ gap: th.spacing[2] }}>
            <Button
              iconLeft={<Sparkles size={18} color={th.color.textOnBrand} />}
              onPress={() => router.push('/vocabulary/generate')}
            >
              {t('fc_gen_new_btn')}
            </Button>
            <Button
              variant="secondary"
              iconLeft={<Plus size={18} color={th.color.textStrong} />}
              onPress={() => router.push('/vocabulary/new')}
            >
              {t('fc_new_topic')}
            </Button>
          </View>
        ) : null}

        {isLoading && !topics ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
        ) : null}

        {!isLoading && topics && topics.length === 0 ? (
          <Card>
            <Heading>{t('fc_no_topics')}</Heading>
            {isStaff ? <Muted>{t('fc_no_topics_sub')}</Muted> : null}
          </Card>
        ) : null}

        {error && !topics ? (
          <Card>
            <Body style={{ color: th.status.danger }}>{t('m_offline')}</Body>
            <Button
              variant="secondary"
              onPress={() => refetch()}
              style={{ marginTop: th.spacing[3] }}
            >
              {t('m_retry')}
            </Button>
          </Card>
        ) : null}

        {(topics ?? []).map((topic) => {
          const cat =
            th.category[
              (topic.color as ColorIdKey) in th.category ? (topic.color as ColorIdKey) : 'violet'
            ];
          const syncedAt = downloaded.get(topic.id) ?? null;
          const isDownloaded = syncedAt !== null;
          const busy =
            (download.isPending && download.variables === (topic.slug ?? topic.id)) ||
            (remove.isPending && remove.variables === topic.id);

          return (
            <Card key={topic.id} onPress={() => open(topic)} style={{ gap: th.spacing[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: cat.base,
                  }}
                />
                <Heading style={{ flex: 1 }} numberOfLines={1}>
                  {topic.name}
                </Heading>
                {isStaff ? (
                  <>
                    <IconButton
                      size="sm"
                      label={t('edit')}
                      onPress={() =>
                        router.push(
                          `/vocabulary/${encodeURIComponent(topic.slug ?? topic.id)}/edit`,
                        )
                      }
                    >
                      <Pencil size={16} color={th.color.textMuted} />
                    </IconButton>
                    <IconButton size="sm" label={t('delete')} onPress={() => del.mutate(topic.id)}>
                      <Trash2 size={16} color={th.status.danger} />
                    </IconButton>
                  </>
                ) : null}
              </View>

              {topic.description ? <Muted numberOfLines={2}>{topic.description}</Muted> : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
                <Muted style={{ flex: 1 }}>{t('fc_word_count', { n: topic.wordCount })}</Muted>

                {/* Download toggle. Explicit, per topic, with the last refresh time visible so
                    stale offline content is never a mystery. */}
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isDownloaded, busy }}
                  accessibilityLabel={isDownloaded ? t('m_remove_download') : t('m_download')}
                  // Draws 18dp tall, so hitSlop 12 gave 42dp effective — under the 48dp floor.
                  // 15 makes it exactly 48 without moving a pixel visually.
                  hitSlop={15}
                  disabled={busy}
                  onPress={() =>
                    isDownloaded ? remove.mutate(topic.id) : download.mutate(topic.slug ?? topic.id)
                  }
                  style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={th.color.brand} />
                  ) : isDownloaded ? (
                    <Check size={18} color={th.status.success} />
                  ) : (
                    <CloudDownload size={18} color={th.color.textMuted} />
                  )}
                  <Mono>
                    {busy
                      ? t('m_downloading')
                      : isDownloaded
                        ? t('m_synced_ago', { ago: agoLabel(t, syncedAt) })
                        : t('m_download')}
                  </Mono>
                </Pressable>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
