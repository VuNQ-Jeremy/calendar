import React from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { ClipboardList, Flag, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang, locale } from '~/lib/i18n';
import { iso, todayDate } from '~/lib/cal';
import * as api from '~/lib/endpoints';
import { useClasses, useHomework, useInvalidateStaff } from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import {
  Body,
  Button,
  Card,
  Checkbox,
  Heading,
  IconButton,
  Muted,
  ProgressBar,
  Screen,
  Tabs,
  Tag,
} from '~/ui';

/**
 * Task 4.4 — homework: the checklist, plus the way in to grading.
 *
 * Port of `HomeworkScreen` in `src/screens-core.tsx`. The done toggle is optimistic through React
 * Query's mutation state (the web does the same thing with `fetcher.formData`), because a checkbox
 * that waits for a round trip on a Vietnamese mobile connection feels broken.
 */
export default function HomeworkList() {
  const th = useTheme();
  const { t, lang } = useLang();
  const invalidate = useInvalidateStaff();

  const { data: homework, isLoading, isRefetching, error, refetch } = useHomework();
  const { data: classes } = useClasses();

  const [filter, setFilter] = React.useState('all');
  const today = iso(todayDate());

  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.homework.update(id, { done }),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.homework.remove(id),
    onSuccess: () => void invalidate(),
  });

  const all = homework ?? [];
  const list = all.filter((h) => (filter === 'all' ? true : filter === 'open' ? !h.done : h.done));
  const doneCount = all.filter((h) => h.done).length;
  const pct = all.length ? Math.round((doneCount / all.length) * 100) : 0;
  const className = (id: string | null | undefined) =>
    classes?.find((c) => c.id === id)?.name ?? t('no_class');

  const confirmDelete = (id: string, title: string) =>
    Alert.alert(t('delete'), title, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => remove.mutate(id) },
    ]);

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('hw_title')} subtitle={t('hw_sub')} />

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
        <Button
          iconLeft={<Plus size={18} color={th.color.textOnBrand} />}
          onPress={() => router.push('/homework/new')}
        >
          {t('hw_add')}
        </Button>

        <Card flat style={{ padding: th.spacing[4], gap: th.spacing[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Body style={{ flex: 1, fontFamily: th.font.bodyBold }}>
              {t('hw_complete', { done: doneCount, total: all.length })}
            </Body>
            <Muted style={{ fontFamily: th.font.mono }}>{`${pct}%`}</Muted>
          </View>
          <ProgressBar value={pct} color="green" />
        </Card>

        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'all', label: t('all') },
            { id: 'open', label: t('hw_tab_open') },
            { id: 'done', label: t('hw_tab_done') },
          ]}
        />

        {isLoading && !homework ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[6] }} />
        ) : null}

        {error && !homework ? (
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

        {homework && !list.length ? (
          <Card>
            <Heading>{t('hw_no_tasks')}</Heading>
            <Muted>{t('hw_add_start')}</Muted>
          </Card>
        ) : null}

        {list.map((h) => {
          // Optimistic: while this row's toggle is in flight, show where it is going.
          const pendingDone =
            toggle.isPending && toggle.variables?.id === h.id ? toggle.variables.done : h.done;
          const overdue = !pendingDone && h.due && h.due < today;

          return (
            <Card key={h.id} flat style={{ padding: th.spacing[4], gap: th.spacing[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: th.spacing[3] }}>
                <Checkbox
                  checked={!!pendingDone}
                  onChange={(next) => toggle.mutate({ id: h.id, done: next })}
                />
                <View style={{ flex: 1, minWidth: 0, gap: th.spacing[2] }}>
                  <Body
                    style={{
                      fontFamily: th.font.bodyBold,
                      textDecorationLine: pendingDone ? 'line-through' : 'none',
                      opacity: pendingDone ? 0.55 : 1,
                    }}
                    numberOfLines={3}
                  >
                    {h.title}
                  </Body>

                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: th.spacing[2],
                      flexWrap: 'wrap',
                    }}
                  >
                    <Tag color={h.color}>{className(h.classId)}</Tag>
                    {h.due ? (
                      overdue ? (
                        <Muted style={{ color: th.status.danger, fontFamily: th.font.bodyBold }}>
                          {t('hw_overdue')}
                        </Muted>
                      ) : (
                        <Muted>
                          {new Date(h.due).toLocaleDateString(locale(lang), {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </Muted>
                      )
                    ) : null}
                    {h.points != null ? (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: th.spacing[1],
                        }}
                      >
                        <Flag size={12} color={th.color.textMuted} />
                        <Muted>{t('hw_pts', { n: h.points })}</Muted>
                      </View>
                    ) : null}
                  </View>

                  {h.notes ? <Muted numberOfLines={3}>{h.notes}</Muted> : null}
                </View>
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: th.spacing[2],
                  minHeight: TOUCH,
                }}
              >
                {/* Grading needs a roster, so it only exists for class homework. */}
                {h.classId ? (
                  <Button
                    variant="soft"
                    onPress={() => router.push(`/homework/${h.id}/grade`)}
                    iconLeft={<ClipboardList size={16} color={th.color.brandSoftInk} />}
                  >
                    {t('hw_grade')}
                  </Button>
                ) : null}
                <View style={{ flex: 1 }} />
                <IconButton label={t('edit')} onPress={() => router.push(`/homework/${h.id}`)}>
                  <Pencil size={18} color={th.color.textMuted} />
                </IconButton>
                <IconButton label={t('delete')} onPress={() => confirmDelete(h.id, h.title)}>
                  <Trash2 size={18} color={th.status.danger} />
                </IconButton>
              </View>
            </Card>
          );
        })}

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}
