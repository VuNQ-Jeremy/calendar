import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarDays, ClipboardCheck, MapPin } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { qk } from '~/lib/query';
import { fmtTime } from '~/lib/cal';
import { useTheme } from '~/theme';
import { Body, Card, Heading, Muted, Screen, Tag, Title } from '~/ui';
import type { UpcomingSession } from '~/lib/types';

/**
 * "Lịch học" — a student's upcoming sessions and what each one covers.
 *
 * The first session-shaped screen students have ever had: until now their app was Vocabulary and
 * Profile, and everything about when they were next in class lived in a parent's head. Staff get
 * `href: null` for this tab in the layout — they have the calendar.
 *
 * `staleTime: 0` on purpose. The list is computed against the SERVER clock (a session drops off
 * once it has ended) so it refetches whenever the app comes back to the foreground, for the same
 * reason app/routes/my-tests.tsx refuses to cache at all.
 */
export default function ScheduleScreen() {
  const th = useTheme();
  const { t, lang } = useLang();

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: qk.mySessions,
    queryFn: api.mySessions,
    staleTime: 0,
  });

  const groups = React.useMemo(() => groupByDate(data?.items ?? []), [data]);

  return (
    <Screen edges={{ top: true }}>
      <View
        style={{
          paddingHorizontal: th.spacing[5],
          paddingTop: th.spacing[4],
          paddingBottom: th.spacing[2],
        }}
      >
        <Title>{t('sched_title')}</Title>
        <Muted>{t('sched_sub')}</Muted>
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
          {!groups.length ? (
            <Card
              style={{ alignItems: 'center', gap: th.spacing[2], paddingVertical: th.spacing[8] }}
            >
              <CalendarDays size={32} color={th.color.textDisabled} />
              <Heading>{t('sched_empty')}</Heading>
            </Card>
          ) : (
            groups.map(([date, items]) => (
              <View key={date} style={{ gap: th.spacing[3] }}>
                <Body style={{ fontFamily: th.font.bodyBold }}>
                  {dayLabel(date, data!.serverNow, lang, t)}
                </Body>
                {items.map((s) => (
                  <SessionCard key={`${s.eventId}:${s.date}`} session={s} />
                ))}
              </View>
            ))
          )}
          <View style={{ height: th.spacing[10] }} />
        </ScrollView>
      )}
    </Screen>
  );
}

function SessionCard({ session: s }: { session: UpcomingSession }) {
  const th = useTheme();
  const { t } = useLang();
  const p = s.preview;
  const nothingNoted = !p.focusText.trim() && !p.tests.length && !p.vocabTopic;

  return (
    <Card style={{ gap: th.spacing[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Heading numberOfLines={1}>{s.className}</Heading>
          <Muted>
            {[s.start ? fmtTime(s.start) : null, s.title !== s.className ? s.title : null]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        </View>
        <Tag color={s.classColor} dot>
          {s.start ? fmtTime(s.start) : '—'}
        </Tag>
      </View>

      {s.location ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
          <MapPin size={14} color={th.color.textMuted} />
          <Muted>{s.location}</Muted>
        </View>
      ) : null}

      {nothingNoted ? (
        <Muted>{t('sched_no_preview')}</Muted>
      ) : (
        <View style={{ gap: th.spacing[3] }}>
          {p.focusText.trim() ? (
            <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
              <BookOpen size={16} color={th.color.textMuted} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Muted style={{ fontSize: th.text.xs.fontSize }}>{t('prev_slip_study')}</Muted>
                <Body>{p.focusText.trim()}</Body>
              </View>
            </View>
          ) : null}

          {p.tests.length || p.vocabTopic ? (
            <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
              <ClipboardCheck size={16} color={th.color.textMuted} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: th.spacing[2] }}>
                <Muted style={{ fontSize: th.text.xs.fontSize }}>{t('prev_slip_check')}</Muted>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
                  {p.tests.map((x) => (
                    <Tag key={x.id} color={s.classColor}>
                      {x.title}
                    </Tag>
                  ))}
                  {p.vocabTopic ? (
                    <Tag color="violet">
                      {`${p.vocabTopic.name} · ${t('prev_slip_words', {
                        n: p.vocabTopic.wordCount,
                      })}`}
                    </Tag>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}
        </View>
      )}
    </Card>
  );
}

/** Preserve the server's ordering; it already sorted by (date, start). */
function groupByDate(items: UpcomingSession[]): [string, UpcomingSession[]][] {
  const out: [string, UpcomingSession[]][] = [];
  for (const s of items) {
    const last = out[out.length - 1];
    if (last && last[0] === s.date) last[1].push(s);
    else out.push([s.date, [s]]);
  }
  return out;
}

/**
 * "Hôm nay" / "Ngày mai" / a plain date. Today is taken from `serverNow` in ICT rather than the
 * device clock, so a phone with the wrong timezone still agrees with the list it is labelling.
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
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}
