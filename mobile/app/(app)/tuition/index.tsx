import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { qk } from '~/lib/query';
import { useTheme, TOUCH } from '~/theme';
import { Badge, Card, Heading, Muted, Screen } from '~/ui';
import { formatVnd } from '@mochi/shared/logic/fees';
import { monthLabel } from '@mochi/shared/logic/month';
import type { MyTuitionMonth } from '~/lib/types';

/**
 * "Học phí" — the student's own closed months.
 *
 * The first time a family can see a fee without asking the office. Only CLOSED months appear: an
 * open one is a running total that moves with every attendance mark, and quoting it would mean the
 * number a parent wrote down on Tuesday is not the one they are asked for on Friday.
 *
 * Reached from Profile rather than a tab. Fees are checked about once a month; the three student
 * tabs are for things checked daily.
 *
 * `staleTime: 0`: the lines are frozen but the PAYMENT against them is not — the office records a
 * transfer days after the close, and this list is where "chưa đóng" has to turn into "đã đóng".
 */
export default function MyTuitionScreen() {
  const th = useTheme();
  const { t, lang } = useLang();
  const router = useRouter();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: qk.myTuition,
    queryFn: api.myTuition.list,
    staleTime: 0,
  });

  const months = data?.months ?? [];

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('tuition_me_title')} subtitle={t('tuition_me_sub')} />

      {isLoading && !data ? (
        <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[3] }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
        >
          {months.length === 0 ? (
            <Card style={{ gap: th.spacing[2] }}>
              <Heading>{t('tuition_me_empty')}</Heading>
              <Muted>{t('tuition_me_empty_sub')}</Muted>
            </Card>
          ) : (
            months.map((m) => (
              <MonthRow
                key={m.month}
                month={m}
                label={monthLabel(m.month, lang)}
                onPress={() => router.push(`/tuition/${m.month}`)}
              />
            ))
          )}
          <View style={{ height: TOUCH }} />
        </ScrollView>
      )}
    </Screen>
  );
}

const STATUS_TONE = {
  paid: { color: 'green', tk: 'tuition_status_paid' },
  partial: { color: 'orange', tk: 'tuition_status_partial' },
  unpaid: { color: 'rose', tk: 'tuition_status_unpaid' },
} as const;

function MonthRow({
  month,
  label,
  onPress,
}: {
  month: MyTuitionMonth;
  label: string;
  onPress: () => void;
}) {
  const th = useTheme();
  const { t } = useLang();
  const tone = STATUS_TONE[month.status];

  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
        <View style={{ flex: 1, gap: th.spacing[1] }}>
          <Heading>{label}</Heading>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
            <Badge color={tone.color}>{t(tone.tk)}</Badge>
            {/* Outstanding, not the total: what is still owed is the number being looked for. */}
            <Muted>
              {month.outstandingVnd > 0
                ? `${t('tuition_outstanding')}: ${formatVnd(month.outstandingVnd)}`
                : formatVnd(month.dueVnd)}
            </Muted>
          </View>
        </View>
        <ChevronRight size={20} color={th.color.textMuted} />
      </Card>
    </Pressable>
  );
}
