import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { BookOpen, Check, ChevronRight, FolderOpen, MapPin, Users } from 'lucide-react-native';
import { useAuth } from '~/lib/auth';
import { useLang, locale } from '~/lib/i18n';
import { eventsOn, fmtTime, todayDate } from '~/lib/cal';
import { useDashboard, useInvalidateStaff, useMaterials, useStudents } from '~/lib/staff-data';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, Muted, Screen, Tag, Title } from '~/ui';
import type { ColorIdKey } from '@mochi/shared/tokens';

/**
 * Role guard.
 *
 * `dashboard` is HIDDEN for a student (`href: null` in (app)/_layout.tsx), not removed from the
 * navigator, so the route stays focusable by anything that names it — a `mochi:///dashboard`
 * deep link, say. Rendering the staff screen for a student fires every query in
 * ~/lib/staff-data and paints a grid of 403s, which is what back used to do before the tab
 * router got `backBehavior="fullHistory"`. Belt and braces with that, and the same role split
 * as app/index.tsx.
 *
 * The staff screen is a separate MODULE-SCOPE component, not an early return inside one: that
 * way a student never mounts the staff hooks at all.
 */
export default function Dashboard() {
  const { user } = useAuth();
  if (user?.kind === 'student') return <Redirect href="/vocabulary" />;
  return <StaffDashboard />;
}

/**
 * Task 4.1 — the teaching day, one screen.
 *
 * Port of `DashboardScreen` in `src/screens-core.tsx`. The web's stat grid and its `1.4fr 1fr`
 * two-column body are a single column here — they already reflow at 920px, so this is the same
 * design taken one step further, not a different one.
 *
 * The web's fourth stat and its second card are the Tests feature (`stat_needs_grading`,
 * `dash_open_tests`), which has no mobile endpoints yet: `/api/dashboard` returns only
 * `today`, `todayEvents` and `classes`. Rather than invent a card with nothing behind it, the
 * homework card and stat that used to sit here are simply gone until Tests reaches the phone.
 *
 * The mobile-only addition is the **Take attendance** shortcut on every one of today's class
 * events. That is the whole point of the phone: two taps from a cold launch to marking a register,
 * against the web's open-laptop, find-event, open-modal, find-tab.
 */
function StaffDashboard() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { user } = useAuth();
  const invalidate = useInvalidateStaff();

  const dash = useDashboard();
  const { data: students } = useStudents();
  const { data: materials } = useMaterials();

  const today = todayDate();
  const todaysEvents = dash.data?.todayEvents;
  const todays = React.useMemo(
    () => eventsOn(todaysEvents ?? [], todayDate()),
    [todaysEvents],
  );

  const classes = dash.data?.classes ?? [];
  const className = (id: string | null) => classes.find((c) => c.id === id)?.name;

  const todayStr = today.toLocaleDateString(locale(lang), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const stats: { icon: React.ReactNode; num: number; label: string }[] = [
    {
      icon: <BookOpen size={22} color={th.category.green.ink} />,
      num: classes.length,
      label: t('stat_classes'),
    },
    {
      icon: <Users size={22} color={th.category.blue.ink} />,
      num: students?.length ?? 0,
      label: t('stat_students'),
    },
    {
      icon: <FolderOpen size={22} color={th.category.violet.ink} />,
      num: materials?.length ?? 0,
      label: t('stat_materials'),
    },
  ];

  return (
    <Screen edges={{ top: true }}>
      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        refreshControl={
          <RefreshControl
            refreshing={dash.isRefetching}
            onRefresh={() => void invalidate()}
            tintColor={th.color.brand}
          />
        }
      >
        <View style={{ gap: th.spacing[1] }}>
          <Title>{t('dash_greeting', { name: (user?.name ?? '').split(' ')[0] })}</Title>
          <Muted>
            {t(
              todays.length === 0
                ? 'dash_sub_none'
                : todays.length === 1
                  ? 'dash_sub_one'
                  : 'dash_sub_many',
              { date: todayStr, count: todays.length },
            )}
          </Muted>
        </View>

        {dash.isLoading && !dash.data ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[6] }} />
        ) : null}

        {dash.error && !dash.data ? (
          <Card>
            <Body style={{ color: th.status.danger }}>{t('m_offline')}</Body>
            <Button
              variant="secondary"
              onPress={() => void dash.refetch()}
              style={{ marginTop: th.spacing[3] }}
            >
              {t('m_retry')}
            </Button>
          </Card>
        ) : null}

        {/* ---- Today, the hero section ---- */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
          <Heading style={{ flex: 1 }}>{t('dash_today_schedule')}</Heading>
          <Button
            variant="ghost"
            onPress={() => router.push('/calendar')}
            iconRight={<ChevronRight size={16} color={th.color.textBody} />}
          >
            {t('nav_calendar')}
          </Button>
        </View>

        {todays.length ? (
          todays.map((e, i) => {
            const cat = th.category[(e.color ?? 'orange') as ColorIdKey] ?? th.category.orange;
            return (
              <Card
                key={`${e.id}:${i}`}
                onPress={() => router.push(`/event/${e.id}?date=${e.date}`)}
                style={{ padding: 0, overflow: 'hidden' }}
              >
                <View style={{ flexDirection: 'row' }}>
                  {/* The web's `.lrow__bar` colour stripe. */}
                  <View style={{ width: 6, backgroundColor: cat.base }} />
                  <View style={{ flex: 1, padding: th.spacing[4], gap: th.spacing[2] }}>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}
                    >
                      <Body
                        style={{
                          fontFamily: th.font.mono,
                          fontSize: th.text.sm.fontSize,
                          minWidth: 62,
                        }}
                      >
                        {fmtTime(e.start ?? '00:00')}
                      </Body>
                      <Heading style={{ flex: 1, ...th.text.base }} numberOfLines={2}>
                        {e.title}
                      </Heading>
                    </View>

                    {e.location ? (
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[1] }}
                      >
                        <MapPin size={13} color={th.color.textMuted} />
                        <Muted numberOfLines={1}>{e.location}</Muted>
                      </View>
                    ) : null}

                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: th.spacing[3],
                        flexWrap: 'wrap',
                      }}
                    >
                      {e.classId ? (
                        <Tag color={e.color}>{className(e.classId) || t('class')}</Tag>
                      ) : null}
                      <View style={{ flex: 1 }} />
                      {/* Two taps from launch. Only for class events — a personal event has no
                          roster to mark. */}
                      {e.classId ? (
                        <Button
                          variant="soft"
                          onPress={() => router.push(`/attendance?eventId=${e.id}&date=${e.date}`)}
                          iconLeft={<Check size={16} color={th.color.brandSoftInk} />}
                        >
                          {t('att_take')}
                        </Button>
                      ) : null}
                    </View>
                  </View>
                </View>
              </Card>
            );
          })
        ) : (
          <Card>
            <Heading>{t('dash_nothing_scheduled')}</Heading>
            <Muted>{t('dash_enjoy_quiet')}</Muted>
          </Card>
        )}

        {/* ---- Counts. Last, not first: they are reference, not the job. ---- */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: th.spacing[3],
            marginTop: th.spacing[2],
          }}
        >
          {stats.map((s) => (
            <Card
              key={s.label}
              flat
              style={{
                // Two per row at 360dp, four across on a tablet — no fixed column count.
                flexGrow: 1,
                flexBasis: 140,
                padding: th.spacing[4],
                gap: th.spacing[1],
              }}
            >
              {s.icon}
              <Title style={{ ...th.text.xl }}>{s.num}</Title>
              <Muted numberOfLines={2}>{s.label}</Muted>
            </Card>
          ))}
        </View>

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}
