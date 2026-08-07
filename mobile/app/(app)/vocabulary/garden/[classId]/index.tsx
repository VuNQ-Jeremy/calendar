import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Images } from 'lucide-react-native';
import { MAX_CLASS_TREE_LEVEL, classTreeNext } from '@mochi/shared/logic/garden';
import { ChipSelect } from '~/components/ChipSelect';
import { ScreenHeader } from '~/components/ScreenHeader';
import { ClassTreeSvg } from '~/components/garden/PlantArt';
import { MemberCard, OwnPlantNote, memberCard } from '~/components/garden/MemberCard';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useClassGarden, usePlant, useSnapshots } from '~/lib/use-garden';
import { useTheme } from '~/theme';
import { Body, Card, Heading, Muted, ProgressBar, Screen } from '~/ui';

/**
 * One class's shared garden — the student's view of `src/garden/class-garden.tsx`.
 *
 * Read-only by design. Watering, the event history, assignment tracking and the admin dev tools are
 * a teacher's work and stay on the web (docs/mobile-parity.md); the endpoints exist either way, so
 * this is a scope decision, not a capability gap.
 *
 * The member order is whatever the API returned — by name. **Never re-sort it.** This is a garden
 * the class tends together, not a leaderboard, and sorting by stage or streak would turn it into
 * one.
 */
export default function ClassGardenScreen() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const { classId } = useLocalSearchParams<{ classId: string }>();

  const { data, isLoading, isRefetching, refetch, error } = useClassGarden(classId);
  const { data: snapshots } = useSnapshots(classId);
  // The student's own classes, for the switcher. Rides along on the plant read they already have.
  const { data: plant } = usePlant();
  const classes = plant?.classes ?? [];

  const viewerStudentId = user?.kind === 'student' ? user.id : null;

  const next = data ? classTreeNext(data.tree.points) : null;
  const atMax = !data || next === null || data.tree.level >= MAX_CLASS_TREE_LEVEL;

  return (
    <Screen>
      <ScreenHeader title={t('garden_class_title')} subtitle={data?.className} />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[4], gap: th.spacing[4] }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={th.color.brand} />
        }
      >
        {isLoading && !data ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
        ) : null}

        {error && !data ? (
          <Card>
            <Body style={{ color: th.status.danger }}>{t('m_offline')}</Body>
          </Card>
        ) : null}

        {classes.length > 1 ? (
          <ChipSelect
            label={t('garden_pick_class')}
            value={classId ?? ''}
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => router.setParams({ classId: v })}
          />
        ) : null}

        {data ? (
          <>
            {/* The cooperative tree: one shared level for the whole class, fed by everyone's rounds
                — including rounds that grew nobody's plant, because it counts effort. */}
            <Card>
              <View
                style={{ flexDirection: 'row', gap: th.spacing[4], alignItems: 'center' }}
              >
                <ClassTreeSvg level={data.tree.level} size={96} />
                <View style={{ flex: 1, gap: th.spacing[2] }}>
                  <Heading>{t('garden_tree')}</Heading>
                  <Muted>{t('garden_tree_level', { n: data.tree.level })}</Muted>
                  <ProgressBar
                    color="green"
                    value={atMax ? 100 : Math.round((data.tree.points * 100) / (next ?? 1))}
                  />
                  <Muted>
                    {atMax
                      ? t('garden_tree_max')
                      : t('garden_tree_progress', { points: data.tree.points, next: next ?? 0 })}
                  </Muted>
                </View>
              </View>
            </Card>

            {data.members.length ? (
              // Two per row: a 96px plant plus a readable name does not fit three across at 360dp.
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: th.spacing[3],
                }}
              >
                {data.members.map((m) => (
                  <View key={m.studentId} style={{ width: '47%', flexGrow: 1 }}>
                    <MemberCard
                      m={memberCard(m)}
                      mine={m.studentId === viewerStudentId}
                      note={m.studentId === viewerStudentId ? <OwnPlantNote m={m} /> : null}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <Card>
                <Heading>{t('garden_empty_short')}</Heading>
              </Card>
            )}

            {/* The album: one frozen garden per month, kept after the live one has moved on. */}
            <Card style={{ gap: th.spacing[3] }}>
              <View style={{ flexDirection: 'row', gap: th.spacing[2], alignItems: 'center' }}>
                <Images size={18} color={th.color.textStrong} />
                <Heading>{t('garden_album')}</Heading>
              </View>
              {snapshots && snapshots.length ? (
                <View style={{ flexDirection: 'row', gap: th.spacing[3], flexWrap: 'wrap' }}>
                  {snapshots.map((s) => (
                    <Pressable
                      key={s.month}
                      accessibilityRole="link"
                      onPress={() =>
                        router.push(
                          `/vocabulary/garden/${encodeURIComponent(classId ?? '')}/album/${s.month}`,
                        )
                      }
                      style={{ minHeight: 44, justifyContent: 'center' }}
                    >
                      <Body style={{ color: th.color.brand, fontFamily: th.font.bodyBold }}>
                        {s.month}
                      </Body>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Muted>{t('garden_album_none')}</Muted>
              )}
            </Card>
          </>
        ) : null}

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}
