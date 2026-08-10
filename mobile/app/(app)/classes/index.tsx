import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import { useClasses, useInvalidateStaff, useStudents, useSubjects } from '~/lib/staff-data';
import { useTheme } from '~/theme';
import { Avatar, Body, Button, Card, Heading, Muted, Screen, Tag, Title } from '~/ui';
import type { ColorIdKey } from '@mochi/shared/tokens';

/**
 * Task 4.4 — the class list.
 *
 * The web is a `.cols-3` card grid whose cards open a 600px detail modal
 * (`src/screens-manage/classes.tsx`). Here it is one column of cards that push a detail screen: the
 * modal held a roster, a stats row and a material picker, none of which fit in a sheet on a
 * phone.
 */
export default function ClassesList() {
  const th = useTheme();
  const { t } = useLang();
  const invalidate = useInvalidateStaff();

  const { data: classes, isLoading, isRefetching, error, refetch } = useClasses();
  const { data: students } = useStudents();
  const { data: subjects } = useSubjects();
  const subjectName = React.useMemo(
    () => new Map((subjects ?? []).map((s) => [s.id, s.name])),
    [subjects],
  );

  return (
    <Screen edges={{ top: true }}>
      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void invalidate()}
            tintColor={th.color.brand}
          />
        }
      >
        <View style={{ gap: th.spacing[1] }}>
          <Title>{t('cls_title')}</Title>
          <Muted>{t('cls_sub')}</Muted>
        </View>

        <Button
          iconLeft={<Plus size={18} color={th.color.textOnBrand} />}
          onPress={() => router.push('/classes/new')}
        >
          {t('cls_new')}
        </Button>

        {isLoading && !classes ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
        ) : null}

        {error && !classes ? (
          <Card>
            <Body style={{ color: th.status.danger }}>{t('m_offline')}</Body>
            <Button
              variant="secondary"
              onPress={() => void refetch()}
              style={{ marginTop: th.spacing[3] }}
            >
              {t('m_retry')}
            </Button>
          </Card>
        ) : null}

        {classes && !classes.length ? (
          <Card>
            <Heading>{t('cls_title')}</Heading>
            <Muted>{t('cls_sub')}</Muted>
          </Card>
        ) : null}

        {(classes ?? []).map((c) => {
          const cat = th.category[(c.color ?? 'green') as ColorIdKey] ?? th.category.green;
          const roster = (students ?? []).filter((s) => c.studentIds.includes(s.id));
          return (
            <Card
              key={c.id}
              onPress={() => router.push(`/classes/${c.id}`)}
              style={{ padding: 0, overflow: 'hidden' }}
            >
              {/* The web card's 8px colour cap. */}
              <View style={{ height: 8, backgroundColor: cat.base }} />
              <View style={{ padding: th.spacing[4], gap: th.spacing[3] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
                  <Heading style={{ flex: 1 }} numberOfLines={2}>
                    {c.name}
                  </Heading>
                  <ChevronRight size={18} color={th.color.textDisabled} />
                </View>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: th.spacing[3],
                    flexWrap: 'wrap',
                  }}
                >
                  <Tag color={c.color}>
                    {subjectName.get(c.subjectId ?? '') || t('cls_general')}
                  </Tag>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
                  {/* Overlapping avatars, as on the web's `.avatar-stack`. */}
                  <View style={{ flexDirection: 'row' }}>
                    {roster.slice(0, 5).map((s, i) => (
                      <Avatar
                        key={s.id}
                        name={s.name}
                        color={s.color}
                        size="sm"
                        style={{ marginLeft: i === 0 ? 0 : -10 }}
                      />
                    ))}
                  </View>
                  <Muted style={{ flex: 1 }}>{t('cls_students_n', { n: roster.length })}</Muted>
                </View>
              </View>
            </Card>
          );
        })}

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}
