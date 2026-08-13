import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react-native';
import { MoveEventSheet, type MoveTarget } from '~/components/MoveEventSheet';
import { getCal, useLang } from '~/lib/i18n';
import {
  addDays,
  byStart,
  eventsOn,
  expandEvents,
  fmtTime,
  iso,
  startOfWeek,
  todayDate,
  toMin,
  type ExpandedEvent,
} from '~/lib/cal';
import { useCalTheme, useEventMutations, useEvents, useInvalidateStaff } from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import { Body, Button, Card, Heading, IconButton, Muted, Screen, Tabs, Title } from '~/ui';
import type { ColorIdKey } from '@mochi/shared/tokens';
import type { EventRow, ThemeRow } from '~/lib/types';

/**
 * Task 4.2 — the calendar, rebuilt rather than ported.
 *
 * The web is a 7-column time grid with a 200px toolbar title and four view tabs on one row. None
 * of that survives 375dp, and shrinking it produces something worse than a rethink. What the phone
 * gets instead:
 *
 *   **Agenda** is the default and the primary view — a `SectionList` grouped by day, scrolling
 *   forward, with sticky date headers. It is what a phone calendar should be, and it is the only
 *   view that answers "what's next" without any navigation at all.
 *
 *   **Month** is a *navigator*, not a reader: a 7×6 grid of dots, not the web's `.mpill` event
 *   pills. Three pills of text per cell at 51dp wide is unreadable; a dot per event is not. Tapping
 *   a day reveals that day's events beneath the grid.
 *
 *   **Day** is a single-column time grid — the one time-grid shape that works on a phone.
 *
 *   **Week is deliberately not built.** Seven columns of time grid on a 375dp screen is 53dp per
 *   day. Paging it one day at a time, as the phase doc notes, would just be Day view with extra
 *   machinery. The segmented control has three options, not four.
 *
 * Recurrence goes through `expandEvents` from `@mochi/shared/logic/recurrence` — the same function
 * the web calls. Two views disagreeing about which days a weekly class falls on would be the kind
 * of bug that costs a user's trust in the whole app.
 */

type ViewMode = 'agenda' | 'month' | 'day';

/** How far ahead the agenda reaches on first render, and how much each pull adds. */
const AGENDA_WINDOW_DAYS = 30;

/** Hour-row height for the day grid — the web's `HR_H` in src/calendar/utils.ts. */
const HOUR_H = 56;

interface DaySection {
  dk: string;
  day: Date;
  data: ExpandedEvent[];
}

export default function Calendar() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { months, monthsShort, dow, dowMon } = getCal(lang);
  const invalidate = useInvalidateStaff();

  const { data: events, isLoading, isRefetching, error, refetch } = useEvents();
  const { data: calTheme } = useCalTheme();
  const { update } = useEventMutations();

  const [view, setView] = React.useState<ViewMode>('agenda');
  const [cursor, setCursor] = React.useState<Date>(() => todayDate());
  const [selectedDay, setSelectedDay] = React.useState<string>(() => iso(todayDate()));
  const [horizon, setHorizon] = React.useState(AGENDA_WINDOW_DAYS);
  const [moveTarget, setMoveTarget] = React.useState<MoveTarget | null>(null);

  const today = iso(todayDate());

  // ---- Agenda sections ----
  const sections: DaySection[] = React.useMemo(() => {
    if (!events) return [];
    const start = todayDate();
    const end = addDays(start, horizon);
    const all = expandEvents(events, start, end);
    const out: DaySection[] = [];
    for (let i = 0; i <= horizon; i++) {
      const day = addDays(start, i);
      const dk = iso(day);
      const data = all.filter((e) => e.date === dk).sort(byStart);
      // Empty days are omitted: a list of "nothing on" rows is scroll cost with no information.
      if (data.length) out.push({ dk, day, data });
    }
    return out;
  }, [events, horizon]);

  // ---- Month cells ----
  const monthCells = React.useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);

  const monthExpanded = React.useMemo(() => {
    if (!events || !monthCells.length) return [];
    return expandEvents(events, monthCells[0], monthCells[41]);
  }, [events, monthCells]);

  const dayEvents = React.useMemo(() => (events ? eventsOn(events, cursor) : []), [events, cursor]);

  const selectedEvents = React.useMemo(
    () => monthExpanded.filter((e) => e.date === selectedDay).sort(byStart),
    [monthExpanded, selectedDay],
  );

  const go = (dir: number) => {
    if (view === 'month') {
      setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
    } else {
      setCursor((c) => addDays(c, dir));
    }
  };

  const title =
    view === 'agenda'
      ? t('cal_upcoming')
      : view === 'month'
        ? `${months[cursor.getMonth()]} ${cursor.getFullYear()}`
        : `${dow[cursor.getDay()]}, ${monthsShort[cursor.getMonth()]} ${cursor.getDate()}`;

  const openEvent = (ev: EventRow, date: string) =>
    router.push(`/event/${ev.id}?date=${encodeURIComponent(date)}`);

  const openNew = (date?: string, start?: string) => {
    const q = new URLSearchParams({ date: date ?? today });
    if (start) q.set('start', start);
    router.push(`/event/new?${q.toString()}`);
  };

  const applyMove = (patch: { id: string; date?: string; start: string; end: string }) => {
    const { id, ...rest } = patch;
    update.mutate({ id, patch: rest });
  };

  const bg = calTheme?.bg ?? th.color.bgPage;

  return (
    <Screen edges={{ top: true }}>
      {/* ---- Toolbar. Two rows, because a 200px title plus four tabs plus three buttons is what
           made the web toolbar unportable. ---- */}
      <View
        style={{
          paddingHorizontal: th.spacing[5],
          paddingTop: th.spacing[3],
          paddingBottom: th.spacing[3],
          gap: th.spacing[3],
          backgroundColor: calTheme?.header ?? th.color.surfaceCard,
          borderBottomWidth: 1,
          borderBottomColor: calTheme?.gridLine ?? th.color.borderSubtle,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
          <Title style={{ flex: 1, ...th.text.lg }} numberOfLines={1}>
            {title}
          </Title>

          {view === 'agenda' ? null : (
            <>
              <IconButton label={t('dp_prev_month')} size="sm" onPress={() => go(-1)}>
                <ChevronLeft size={20} color={th.color.textBody} />
              </IconButton>
              <IconButton label={t('dp_next_month')} size="sm" onPress={() => go(1)}>
                <ChevronRight size={20} color={th.color.textBody} />
              </IconButton>
              <Button
                variant="secondary"
                onPress={() => {
                  setCursor(todayDate());
                  setSelectedDay(today);
                }}
              >
                {t('today')}
              </Button>
            </>
          )}
          <IconButton
            label={t('cal_new_event')}
            variant="solid"
            onPress={() => openNew(view === 'agenda' ? today : iso(cursor))}
          >
            <Plus size={20} color={th.color.textOnBrand} />
          </IconButton>
        </View>

        <Tabs
          value={view}
          onChange={(v) => setView(v as ViewMode)}
          tabs={[
            { id: 'agenda', label: t('view_agenda') },
            { id: 'month', label: t('view_month') },
            { id: 'day', label: t('view_day') },
          ]}
        />
      </View>

      {/* The themed calendar surface. `--cal-bg` / `--cal-grid` / `--cal-today` / `--cal-header`
          are CSS vars on the web; here they are inline styles over the same stored values. */}
      <View style={{ flex: 1, backgroundColor: bg }}>
        <CalendarBackdrop theme={calTheme} />

        {isLoading && !events ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
        ) : error && !events ? (
          <View style={{ padding: th.spacing[5] }}>
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
          </View>
        ) : view === 'agenda' ? (
          <SectionList
            sections={sections}
            keyExtractor={(item, index) => `${item.id}:${item.date}:${index}`}
            stickySectionHeadersEnabled
            contentContainerStyle={{ padding: th.spacing[4], gap: th.spacing[2] }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void invalidate()}
                tintColor={th.color.brand}
              />
            }
            // Forward-only infinite scroll. The past is reachable through Month, which is where
            // anyone looking backwards actually goes.
            onEndReachedThreshold={0.6}
            onEndReached={() => setHorizon((h) => h + AGENDA_WINDOW_DAYS)}
            renderSectionHeader={({ section }) => (
              <AgendaHeader
                day={section.day}
                dk={section.dk}
                isToday={section.dk === today}
                bg={bg}
              />
            )}
            renderItem={({ item, section }) => (
              <EventRowCard
                event={item}
                onPress={() => openEvent(item, section.dk)}
                onLongPress={() => setMoveTarget({ event: item, date: section.dk })}
              />
            )}
            ListEmptyComponent={
              <Card>
                <Heading>{t('agenda_empty_title')}</Heading>
                <Muted>{t('agenda_empty_sub')}</Muted>
              </Card>
            }
            ListFooterComponent={<View style={{ height: th.spacing[10] }} />}
          />
        ) : view === 'month' ? (
          <ScrollView contentContainerStyle={{ padding: th.spacing[3], gap: th.spacing[3] }}>
            <MonthGrid
              cells={monthCells}
              cursorMonth={cursor.getMonth()}
              expanded={monthExpanded}
              today={today}
              selected={selectedDay}
              dowLabels={dowMon}
              theme={calTheme}
              onPick={(dk) => setSelectedDay(dk)}
            />

            <Heading style={{ ...th.text.base, marginTop: th.spacing[2] }}>
              {monthDayLabel(selectedDay, dow, monthsShort)}
            </Heading>

            {selectedEvents.length ? (
              selectedEvents.map((e, i) => (
                <EventRowCard
                  key={`${e.id}:${i}`}
                  event={e}
                  onPress={() => openEvent(e, selectedDay)}
                  onLongPress={() => setMoveTarget({ event: e, date: selectedDay })}
                />
              ))
            ) : (
              <Card flat>
                <Muted>{t('cal_day_empty')}</Muted>
                <Button
                  variant="secondary"
                  onPress={() => openNew(selectedDay)}
                  style={{ marginTop: th.spacing[3] }}
                >
                  {t('cal_new_event')}
                </Button>
              </Card>
            )}
            <View style={{ height: th.spacing[10] }} />
          </ScrollView>
        ) : (
          <DayGrid
            day={cursor}
            events={dayEvents}
            theme={calTheme}
            isToday={iso(cursor) === today}
            onPick={(e) => openEvent(e, iso(cursor))}
            onLongPress={(e) => setMoveTarget({ event: e, date: iso(cursor) })}
            onCreate={(start) => openNew(iso(cursor), start)}
          />
        )}
      </View>

      <MoveEventSheet target={moveTarget} onClose={() => setMoveTarget(null)} onMove={applyMove} />
    </Screen>
  );
}

/**
 * `bgImage` / `bgOpacity` from the theme, honoured rather than silently dropped — a wallpaper the
 * user chose on the web that simply does not appear on the phone reads as a broken app.
 */
function CalendarBackdrop({ theme }: { theme: ThemeRow | undefined }) {
  if (!theme?.bgImage) return null;
  return (
    // The wrapper carries `pointerEvents`, not the Image: taps must reach the grid underneath.
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Image
        source={{ uri: theme.bgImage }}
        resizeMode="cover"
        style={{ width: '100%', height: '100%', opacity: theme.bgOpacity ?? 0.12 }}
      />
    </View>
  );
}

/** The sticky day header. Opaque: a transparent sticky header smears the rows under it. */
function AgendaHeader({
  day,
  dk,
  isToday,
  bg,
}: {
  day: Date;
  dk: string;
  isToday: boolean;
  bg: string;
}) {
  const th = useTheme();
  const { t, lang } = useLang();
  const { dow, monthsShort } = getCal(lang);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: th.spacing[2],
        paddingVertical: th.spacing[2],
        paddingHorizontal: th.spacing[1],
        backgroundColor: bg,
      }}
    >
      <Heading style={{ ...th.text.base, color: isToday ? th.color.brand : th.color.textStrong }}>
        {isToday ? t('today') : dow[day.getDay()]}
      </Heading>
      <Muted>
        {day.getDate()} {monthsShort[day.getMonth()]}
      </Muted>
      <View style={{ flex: 1 }} />
      <Muted style={{ fontSize: th.text.xs.fontSize }}>{dk}</Muted>
    </View>
  );
}

/** One event, in the agenda and under the month grid. Long-press opens "Move to…". */
function EventRowCard({
  event,
  onPress,
  onLongPress,
}: {
  event: ExpandedEvent | EventRow;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const th = useTheme();
  const cat = th.category[(event.color ?? 'orange') as ColorIdKey] ?? th.category.orange;
  const repeats = !!event.recurrence && event.recurrence !== 'none';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={event.title}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: th.spacing[3],
        minHeight: TOUCH,
        padding: th.spacing[3],
        borderRadius: th.radius.md,
        borderLeftWidth: 5,
        borderLeftColor: cat.base,
        backgroundColor: pressed ? cat.base + '33' : cat.soft,
      })}
    >
      <Body
        style={{ fontFamily: th.font.mono, fontSize: th.text.xs.fontSize, minWidth: 54 }}
        numberOfLines={1}
      >
        {fmtTime(event.start ?? '00:00')}
      </Body>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={{ fontFamily: th.font.bodyBold, color: cat.ink }} numberOfLines={2}>
          {event.title}
        </Body>
        {event.location ? <Muted numberOfLines={1}>{event.location}</Muted> : null}
      </View>
      {repeats ? <Repeat size={14} color={cat.ink} /> : null}
    </Pressable>
  );
}

/**
 * The month navigator: dots, not pills.
 *
 * Cell width at 360dp is about 48dp. The web fits three `.mpill`s with a time and a title in each
 * cell; here that would be three lines of clipped text. Up to three dots plus a `+n` says the same
 * thing — "this day is busy" — in the space available.
 */
function MonthGrid({
  cells,
  cursorMonth,
  expanded,
  today,
  selected,
  dowLabels,
  theme,
  onPick,
}: {
  cells: Date[];
  cursorMonth: number;
  expanded: ExpandedEvent[];
  today: string;
  selected: string;
  dowLabels: string[];
  theme: ThemeRow | undefined;
  onPick: (dk: string) => void;
}) {
  const th = useTheme();
  const gridLine = theme?.gridLine ?? th.color.borderSubtle;

  return (
    <View style={{ gap: th.spacing[1] }}>
      <View style={{ flexDirection: 'row' }}>
        {dowLabels.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: 'center', paddingVertical: th.spacing[1] }}>
            <Muted style={{ fontSize: th.text.xs.fontSize }}>{d}</Muted>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d) => {
          const dk = iso(d);
          const outside = d.getMonth() !== cursorMonth;
          const isToday = dk === today;
          const isSelected = dk === selected;
          const list = expanded.filter((e) => e.date === dk);

          return (
            <Pressable
              key={dk}
              accessibilityRole="button"
              accessibilityLabel={`${dk} — ${list.length}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onPick(dk)}
              style={{
                // Exactly a seventh of the row. A fixed width would overflow at 360dp.
                width: `${100 / 7}%`,
                height: 56,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? th.color.brand : gridLine,
                borderRadius: th.radius.sm,
                backgroundColor: isToday ? (theme?.today ?? th.color.brandSoft) : 'transparent',
                opacity: outside ? 0.4 : 1,
              }}
            >
              <Body style={{ fontSize: th.text.sm.fontSize }}>{d.getDate()}</Body>
              <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center', height: 8 }}>
                {list.slice(0, 3).map((e, j) => {
                  const cat =
                    th.category[(e.color ?? 'orange') as ColorIdKey] ?? th.category.orange;
                  return (
                    <View
                      key={j}
                      style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cat.base }}
                    />
                  );
                })}
                {list.length > 3 ? <Muted style={{ fontSize: 9 }}>+{list.length - 3}</Muted> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Day view: one column of hours, events positioned by their start minute.
 *
 * Tapping empty space creates an event at that hour — the touch equivalent of the web's
 * click-a-slot. Tapping an event opens it; long-pressing opens "Move to…".
 */
function DayGrid({
  day,
  events,
  theme,
  isToday,
  onPick,
  onLongPress,
  onCreate,
}: {
  day: Date;
  events: ExpandedEvent[];
  theme: ThemeRow | undefined;
  isToday: boolean;
  onPick: (e: ExpandedEvent) => void;
  onLongPress: (e: ExpandedEvent) => void;
  onCreate: (start: string) => void;
}) {
  const th = useTheme();
  const { t } = useLang();
  const gridLine = theme?.gridLine ?? th.color.borderSubtle;
  const hours = React.useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  // Opens on the working day rather than midnight — 07:00 is where a school timetable starts.
  const initialScroll = 7 * HOUR_H;

  return (
    <ScrollView
      accessibilityLabel={iso(day)}
      contentContainerStyle={{ paddingBottom: th.spacing[10] }}
      contentOffset={{ x: 0, y: initialScroll }}
    >
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: th.spacing[3],
          paddingVertical: th.spacing[2],
          backgroundColor: isToday ? (theme?.today ?? th.color.brandSoft) : 'transparent',
        }}
      >
        <Muted>
          {events.length ? t('cal_day_count', { n: events.length }) : t('cal_day_empty')}
        </Muted>
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: th.spacing[3] }}>
        {/* Hour gutter */}
        <View style={{ width: 52 }}>
          {hours.map((h) => (
            <View key={h} style={{ height: HOUR_H, justifyContent: 'flex-start' }}>
              <Muted style={{ fontSize: th.text.xs.fontSize }}>
                {fmtTime(`${String(h).padStart(2, '0')}:00`)}
              </Muted>
            </View>
          ))}
        </View>

        {/* Slots and events */}
        <View style={{ flex: 1, position: 'relative' }}>
          {hours.map((h) => (
            <Pressable
              key={h}
              accessibilityRole="button"
              accessibilityLabel={t('cal_new_event')}
              onPress={() => onCreate(`${String(h).padStart(2, '0')}:00`)}
              style={{ height: HOUR_H, borderTopWidth: 1, borderTopColor: gridLine }}
            />
          ))}

          {events.map((e, i) => {
            const cat = th.category[(e.color ?? 'orange') as ColorIdKey] ?? th.category.orange;
            const startMin = toMin(e.start ?? '00:00');
            const endMin = e.end ? toMin(e.end) : startMin + 60;
            const top = (startMin / 60) * HOUR_H;
            // A 30-minute event is 28dp tall, below the touch floor — so the block is clamped to
            // 48dp. Overlapping visuals beat an untappable event.
            const height = Math.max(TOUCH, ((endMin - startMin) / 60) * HOUR_H);

            return (
              <Pressable
                key={`${e.id}:${i}`}
                accessibilityRole="button"
                accessibilityLabel={e.title}
                onPress={() => onPick(e)}
                onLongPress={() => onLongPress(e)}
                style={{
                  position: 'absolute',
                  left: 4,
                  right: 4,
                  top,
                  height,
                  padding: th.spacing[2],
                  borderRadius: th.radius.sm,
                  borderLeftWidth: 4,
                  borderLeftColor: cat.base,
                  backgroundColor: cat.soft,
                  overflow: 'hidden',
                }}
              >
                <Body
                  style={{
                    fontFamily: th.font.bodyBold,
                    fontSize: th.text.sm.fontSize,
                    color: cat.ink,
                  }}
                  numberOfLines={1}
                >
                  {e.title}
                </Body>
                <Muted style={{ fontSize: th.text.xs.fontSize }} numberOfLines={1}>
                  {fmtTime(e.start ?? '00:00')}
                  {e.end ? ` – ${fmtTime(e.end)}` : ''}
                </Muted>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

/** "Mon, 4 Mar" for the day picked out of the month grid. */
function monthDayLabel(dk: string, dow: string[], monthsShort: string[]): string {
  const [y, m, d] = dk.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${dow[date.getDay()]}, ${d} ${monthsShort[m - 1]}`;
}
