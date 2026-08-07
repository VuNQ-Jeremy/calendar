import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { formatDmy } from '@mochi/shared/logic/dates';
import { ScreenHeader } from '~/components/ScreenHeader';
import { ClassTreeSvg } from '~/components/garden/PlantArt';
import { MemberCard } from '~/components/garden/MemberCard';
import { useLang } from '~/lib/i18n';
import { useSnapshot, useSnapshots } from '~/lib/use-garden';
import { useTheme } from '~/theme';
import { Card, Heading, Muted, Screen } from '~/ui';

/**
 * One frozen month of a class garden.
 *
 * Deliberately the same `MemberCard` as the live garden: an album that drifted away from the screen
 * it was a photograph of would be a worse keepsake every release.
 *
 * A month that was never saved is a 404 from the API and an empty state here, not an error — the
 * snapshot job only started running at some point, and the months before it simply have no photo.
 *
 * Class and month are both PATH segments, mirroring the web's `/garden/:classId/album/:month`. The
 * web put the month in the path so each month got its own route-cache entry; here it keeps the two
 * ids in one place and the push a plain template string.
 */
export default function GardenAlbumScreen() {
  const th = useTheme();
  const { t } = useLang();
  const { classId, month } = useLocalSearchParams<{ classId: string; month: string }>();

  const { data, isLoading, isRefetching, refetch, error } = useSnapshot(classId, month);
  // `createdAt` — the day the photo was taken — is on the month LIST, not on the month itself.
  const { data: snapshots } = useSnapshots(classId);
  const createdAt = snapshots?.find((s) => s.month === month)?.createdAt ?? null;

  return (
    <Screen>
      <ScreenHeader
        title={t('garden_album_title', { month: month ?? '' })}
        subtitle={
          createdAt ? t('garden_album_frozen', { date: formatDmy(createdAt.slice(0, 10)) }) : data?.className
        }
      />

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
            <Heading>{t('garden_album_none')}</Heading>
          </Card>
        ) : null}

        {data ? (
          <>
            <Card>
              <View style={{ flexDirection: 'row', gap: th.spacing[4], alignItems: 'center' }}>
                <ClassTreeSvg level={data.data.classTree.level} size={96} />
                <View style={{ flex: 1, gap: th.spacing[1] }}>
                  <Heading>{t('garden_tree')}</Heading>
                  <Muted>{t('garden_tree_level', { n: data.data.classTree.level })}</Muted>
                </View>
              </View>
            </Card>

            {data.data.members.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[3] }}>
                {data.data.members.map((m) => (
                  <View key={m.studentId} style={{ width: '47%', flexGrow: 1 }}>
                    {/* Mapped field by field: the frozen row says `fruitTotal`, the live one
                        `fruitsTotal`. No spread — a rename upstream should break the build here
                        rather than silently draw a zero. */}
                    <MemberCard
                      m={{
                        studentId: m.studentId,
                        name: m.name,
                        color: m.color,
                        plantName: m.plantName,
                        potColor: m.potColor,
                        stage: m.stage,
                        wilted: m.wilted,
                        dead: m.dead,
                        streak: m.streak,
                        fruitMonth: m.fruitMonth,
                        fruitTotal: m.fruitTotal,
                        titleId: m.titleId,
                      }}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <Card>
                <Heading>{t('garden_empty_short')}</Heading>
              </Card>
            )}
          </>
        ) : null}

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}
