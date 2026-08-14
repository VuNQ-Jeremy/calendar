import React from 'react';
import { useFetcher, useLoaderData } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty } from './ui.jsx';
import { colorOf, iso, addDays, parseISO, TODAY, ICON_TINT } from './lib/core.js';
import { expandEvents, fmtTime, toMin } from './calendar/index.jsx';
import { EventModal } from './calendar/event-modal.jsx';
import { KioskModal } from './kiosk/kiosk.jsx';
import { useEventWrites } from './calendar/scope-dialog.jsx';
import { useLang, locale } from './lib/i18n.jsx';
import type { IconName } from './icons.jsx';
import type { ClassRow } from '../server/services/classes.js';
import type { EventRow } from '../server/services/events.js';
import type { StudentRow } from '../server/services/people.js';
import type { MaterialRow } from '../server/services/materials.js';
import type { EventDraft } from './calendar/utils.js';

const { Card: SC, Button: SBtn, Tag: STag, Badge: SBadge } = DS;

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  color: string;
  phone?: string | null;
  avatar?: string;
}

interface DashLoaderData {
  todayEvents: EventRow[];
  /**
   * Rows the "Coming up" card expands: everything dated inside the window below, plus every
   * recurring row (recurrence is expanded here, not in SQL — same as the calendar's views).
   */
  upcomingEvents: EventRow[];
  attemptsSummary: Record<string, { total: number; needsGrading: number; graded: number }>;
  classes: ClassRow[];
  studentCount: number;
  materialCount: number;
  /** Everything past this point exists only to feed the event dialog both cards open. */
  students: StudentRow[];
  materials: MaterialRow[];
  eventMaterials: { eventId: string; materialId: string }[];
}

/**
 * How far past today the "Coming up" card looks. The loader queries exactly this window, so it
 * lives here rather than in the route — and it matches the calendar's Agenda tab, which is the
 * view the card's "more" link hands off to.
 */
export const UPCOMING_DAYS = 14;

/** How many of those occurrences the card lists before deferring to the calendar. */
const UPCOMING_LIMIT = 5;

// ---- StatCard ----
function StatCard({
  icon,
  color,
  num,
  label,
  onClick,
}: {
  icon: IconName;
  color: string;
  num: number;
  label: string;
  onClick?: () => void;
}) {
  return (
    <SC
      interactive
      onClick={onClick}
      style={{ padding: 0, cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="statcard">
        <div className="statcard__icon" style={ICON_TINT(color)}>
          <MIcon name={icon} size={24} />
        </div>
        <div>
          <div className="statcard__num">{num}</div>
          <div className="statcard__label">{label}</div>
        </div>
      </div>
    </SC>
  );
}

/** One row of the dashboard's "Coming up" card: a day label, the title, and its class tag. */
function DashUpcomingItem({
  ev,
  dayLabel,
  className,
  onOpen,
}: {
  ev: EventRow;
  dayLabel: string;
  className?: string;
  onOpen: () => void;
}) {
  const c = colorOf(ev.color);
  return (
    <div className="m-row" style={{ gap: 12, cursor: 'pointer' }} onClick={onOpen}>
      <span style={{ width: 10, height: 10, borderRadius: 9, background: c.base, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--text-sm)' }}>
          {ev.title}
        </div>
        <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
          {[dayLabel, ev.start ? fmtTime(ev.start) : null, ev.location].filter(Boolean).join(' · ')}
        </div>
      </div>
      {className && <STag color={ev.color}>{className}</STag>}
    </div>
  );
}

// ---- Dashboard / Today ----
function DashboardScreen({ user, onNav }: { user: AppUser; onNav: (route: string) => void }) {
  const {
    todayEvents,
    upcomingEvents,
    attemptsSummary,
    classes,
    studentCount,
    materialCount,
    students,
    materials,
    eventMaterials,
  } = useLoaderData() as DashLoaderData;
  const { t, lang } = useLang();
  const fetcher = useFetcher();
  const [editor, setEditor] = React.useState<EventDraft | null>(null);
  const [kiosk, setKiosk] = React.useState<{
    eventId: string;
    date: string;
    classId: string;
  } | null>(null);
  const todays = expandEvents(todayEvents, TODAY, TODAY).sort(
    (a, b) => toMin(a.start ?? '00:00') - toMin(b.start ?? '00:00'),
  );
  // Tomorrow onwards — today already has its own card. `?? []` covers a cached payload written
  // by a build that predates this field (route-cache serves it before the refresh lands).
  const tomorrow = iso(addDays(TODAY, 1));
  const upcoming = React.useMemo(
    () =>
      expandEvents(upcomingEvents ?? [], addDays(TODAY, 1), addDays(TODAY, UPCOMING_DAYS)).sort(
        (a, b) =>
          a.date === b.date
            ? toMin(a.start ?? '00:00') - toMin(b.start ?? '00:00')
            : a.date < b.date
              ? -1
              : 1,
      ),
    [upcomingEvents],
  );
  const needsGrading = Object.values(attemptsSummary).reduce((n, s) => n + s.needsGrading, 0);
  const className = (id: string | null) => classes.find((c) => c.id === id)?.name;
  /** "Tomorrow" for the next day, a short weekday + date after that. */
  const dayLabel = (date: string) =>
    date === tomorrow
      ? t('sched_tomorrow')
      : parseISO(date).toLocaleDateString(locale(lang), {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        });
  const todayStr = new Date(TODAY).toLocaleDateString(locale(lang), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // The same dialog the calendar opens, and the same writes — it posts to /calendar whichever
  // screen it is mounted on, and that route's clientAction invalidates this card's cache for us.
  // Including the scope question a recurring event asks before it changes.
  const openEvent = (ev: EventRow) => setEditor({ ...ev, recurrence: ev.recurrence || 'none' });
  const {
    save: saveEvent,
    del: deleteEvent,
    dialog: scopeDialog,
  } = useEventWrites({ fetcher, editor, setEditor });
  /** Both cards' rows, deduped — the dialog only reads this to date-label shared materials. */
  const allEvents = React.useMemo(() => {
    const byId = new Map<string, EventRow>();
    for (const e of [...todayEvents, ...(upcomingEvents ?? [])]) byId.set(e.id, e);
    return [...byId.values()];
  }, [todayEvents, upcomingEvents]);

  return (
    <div className="content">
      <PageHeader
        title={t('dash_greeting', { name: user.name.split(' ')[0] })}
        subtitle={t(
          todays.length === 0
            ? 'dash_sub_none'
            : todays.length === 1
              ? 'dash_sub_one'
              : 'dash_sub_many',
          { date: todayStr, count: todays.length },
        )}
      />
      <div className="m-grid cols-4">
        <StatCard icon="book" color="green" num={classes.length} label={t('stat_classes')} />
        <StatCard icon="users" color="blue" num={studentCount} label={t('stat_students')} />
        <StatCard
          icon="clipboard"
          color="orange"
          num={needsGrading}
          label={t('stat_needs_grading')}
          onClick={() => onNav('tests')}
        />
        <StatCard icon="folder" color="violet" num={materialCount} label={t('stat_materials')} />
      </div>
      <div className="m-grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        {/* Today's schedule */}
        <SC>
          <div className="m-spread" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('dash_today_schedule')}</h2>
            <SBtn
              variant="ghost"
              size="sm"
              iconRight={<MIcon name="chevronRight" size={16} />}
              onClick={() => onNav('calendar')}
            >
              {t('nav_calendar')}
            </SBtn>
          </div>
          {todays.length ? (
            <div className="m-stack">
              {todays.map((e, i) => {
                const c = colorOf(e.color);
                return (
                  <div
                    key={i}
                    className="lrow"
                    style={{ padding: 12, cursor: 'pointer' }}
                    onClick={() => openEvent(e)}
                  >
                    <div className="lrow__bar" style={{ background: c.base }} />
                    <div
                      className="m-mono"
                      style={{
                        minWidth: 70,
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-body)',
                      }}
                    >
                      {fmtTime(e.start ?? '00:00')}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="lrow__title" style={{ fontSize: 'var(--text-md)' }}>
                        {e.title}
                      </div>
                      {e.location && (
                        <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                          {e.location}
                        </div>
                      )}
                    </div>
                    {e.classId && <STag color={e.color}>{className(e.classId) || t('class')}</STag>}
                    {e.classId && (
                      <SBtn
                        variant="secondary"
                        size="sm"
                        iconLeft={<MIcon name="gift" size={16} />}
                        onClick={(ev: React.MouseEvent) => {
                          // The row itself opens the event dialog; the kiosk is its own surface.
                          ev.stopPropagation();
                          setKiosk({ eventId: e.id, date: e.date, classId: e.classId! });
                        }}
                      >
                        {t('ck_open_kiosk_in')}
                      </SBtn>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              icon="calendar"
              title={t('dash_nothing_scheduled')}
              sub={t('dash_enjoy_quiet')}
            />
          )}
        </SC>
        {/* Coming up */}
        <SC>
          <div className="m-spread" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('dash_upcoming')}</h2>
            {upcoming.length > 0 && <SBadge color="brand">{upcoming.length}</SBadge>}
          </div>
          {upcoming.length ? (
            <div className="m-stack">
              {upcoming.slice(0, UPCOMING_LIMIT).map((e) => (
                <DashUpcomingItem
                  key={`${e.id}:${e.date}`}
                  ev={e}
                  dayLabel={dayLabel(e.date)}
                  className={e.classId ? className(e.classId) || t('class') : undefined}
                  onOpen={() => openEvent(e)}
                />
              ))}
              {upcoming.length > UPCOMING_LIMIT && (
                <SBtn
                  variant="ghost"
                  size="sm"
                  iconRight={<MIcon name="chevronRight" size={16} />}
                  onClick={() => onNav('calendar')}
                >
                  {t('dash_upcoming_more', { n: upcoming.length - UPCOMING_LIMIT })}
                </SBtn>
              )}
            </div>
          ) : (
            <Empty
              icon="calendar"
              title={t('dash_upcoming_none')}
              sub={t('dash_upcoming_none_sub', { days: UPCOMING_DAYS })}
            />
          )}
        </SC>
      </div>

      {kiosk && (
        <KioskModal
          eventId={kiosk.eventId}
          date={kiosk.date}
          classId={kiosk.classId}
          classes={classes ?? []}
          students={students ?? []}
          initialPhase="checkin"
          onClose={() => setKiosk(null)}
        />
      )}

      {/* `?? []` on the three dialog-only lists: route-cache can hydrate a payload written by a
          build that predates them, same reason the "Coming up" expansion guards upcomingEvents. */}
      <EventModal
        open={!!editor}
        onClose={() => setEditor(null)}
        draft={editor}
        onSave={saveEvent}
        onDelete={deleteEvent}
        classes={classes ?? []}
        students={students ?? []}
        materials={materials ?? []}
        eventMaterials={eventMaterials ?? []}
        events={allEvents}
      />
      {scopeDialog}
    </div>
  );
}

export { DashboardScreen };
