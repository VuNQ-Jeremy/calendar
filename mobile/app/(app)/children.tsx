import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronRight, Users } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { qk } from '~/lib/query';
import { fmtTime } from '~/lib/cal';
import { useTheme } from '~/theme';
import { Body, Card, Heading, Muted, Screen, Tag, Title } from '~/ui';
import type { ParentChild } from '~/lib/types';

/**
 * "Con của tôi" — a parent's home: each child and the week ahead.
 *
 * The tab only exists while an admin has the parent portal open (see the layout), so this screen
 * can assume the endpoint answers. One request feeds the whole screen — /api/parent/home returns
 * every child with their sessions already attached.
 *
 * `staleTime: 0` for the same reason as schedule.tsx: the session list is computed against the
 * SERVER clock and a finished class must drop off, so it refetches on foreground.
 */
export default function ChildrenScreen() {
  const th = useTheme();
  const { t, lang } = useLang();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: qk.parentHome,
    queryFn: api.parent.home,
    staleTime: 0,
  });

  const children = data?.children ?? [];

  return (
    <Screen edges={{ top: true }}>
      <View
        style={{
          paddingHorizontal: th.spacing[5],
          paddingTop: th.spacing[4],
          paddingBottom: th.spacing[2],
        }}
      >
        <Title>{t('ch_title')}</Title>
        <Muted>{t('ch_sub')}</Muted>
      </View>

      {isLoading && !data ? (
        <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
      ) : (
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
          {!children.length ? (
            <Card
              style={{ alignItems: 'center', gap: th.spacing[2], paddingVertical: th.spacing[8] }}
            >
              <Users size={32} color={th.color.textDisabled} />
              <Heading style={{ textAlign: 'center' }}>{t('ch_no_children')}</Heading>
            </Card>
          ) : (
            children.map((c) => (
              <ChildCard key={c.id} child={c} serverNow={data!.serverNow} lang={lang} />
            ))
          )}
          <View style={{ height: th.spacing[10] }} />
        </ScrollView>
      )}
    </Screen>
  );
}

/** How many sessions the home card previews before deferring to the child's own screen. */
const PREVIEW_LIMIT = 3;

function ChildCard({
  child: c,
  serverNow,
  lang,
}: {
  child: ParentChild;
  serverNow: string;
  lang: string;
}) {
  const th = useTheme();
  const { t } = useLang();
  const router = useRouter();
  const shown = c.items.slice(0, PREVIEW_LIMIT);

  return (
    // The name rides along so the detail header can draw before its first request resolves.
    <Pressable
      onPress={() => router.push(`/child/${c.id}?name=${encodeURIComponent(c.name)}` as never)}
    >
      <Card style={{ gap: th.spacing[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Heading numberOfLines={1}>{c.name}</Heading>
            {c.classNames.length ? <Muted>{c.classNames.join(' · ')}</Muted> : null}
          </View>
          <Tag color={c.color} dot>
            {t('ch_view_child')}
          </Tag>
          <ChevronRight size={18} color={th.color.textMuted} />
        </View>

        <View style={{ gap: th.spacing[2] }}>
          <Muted style={{ fontSize: th.text.xs.fontSize }}>{t('ch_upcoming')}</Muted>
          {!shown.length ? (
            <Muted>{t('ch_upcoming_none')}</Muted>
          ) : (
            shown.map((s) => (
              <View
                key={`${s.eventId}:${s.date}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}
              >
                <Body style={{ width: 92 }}>{dayLabel(s.date, serverNow, lang, t)}</Body>
                <Body style={{ flex: 1 }} numberOfLines={1}>
                  {s.className}
                </Body>
                <Muted>{s.start ? fmtTime(s.start) : '—'}</Muted>
              </View>
            ))
          )}
          {c.items.length > shown.length ? (
            <Muted>{t('ch_more_sessions', { n: c.items.length - shown.length })}</Muted>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * "Hôm nay" / "Ngày mai" / a plain date. Today comes from `serverNow` in ICT rather than the
 * device clock, so a phone with the wrong timezone still agrees with the list it labels — the
 * same reasoning as schedule.tsx.
 */
function dayLabel(
  date: string,
  serverNow: string,
  lang: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const ict = new Date(new Date(serverNow).getTime() + 7 * 60 * 60_000);
  const today = ict.toISOString().slice(0, 10);
  const tomorrowIct = new Date(ict.getTime() + 86_400_000).toISOString().slice(0, 10);
  if (date === today) return t('sched_today');
  if (date === tomorrowIct) return t('sched_tomorrow');
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    day: 'numeric',
    month: 'short',
  });
}
