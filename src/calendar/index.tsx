import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { PageHeader } from '../ui.jsx';
import { iso, addDays, TODAY } from '../lib/core.js';
import { useLang, getCal } from '../lib/i18n.jsx';
import { EventModal } from './event-modal.jsx';
import { MonthView } from './month-view.jsx';
import { TimeGrid } from './time-grid.jsx';
import { AgendaView } from './agenda-view.jsx';
import { CalendarThemeDrawer } from './theme-drawer.jsx';
import { useEventWrites } from './scope-dialog.jsx';
import { startOfWeek, addMin, fmtTime, toMin, MONTHS, DOW, expandEvents } from './utils.js';
import type { EventRow } from '../../server/services/events.js';
import type { ClassRow } from '../../server/services/classes.js';
import type { StudentRow } from '../../server/services/people.js';
import type { MaterialRow } from '../../server/services/materials.js';
import type { EventDraft } from './utils.js';

const { Button: CBtn, IconButton: CIBtn, Tabs: CTabs } = DS;

interface Theme {
  bg: string;
  gridLine: string;
  today: string;
  header: string;
  bgImage: string | null;
  bgOpacity: number;
}

interface CalendarLoaderData {
  events: EventRow[];
  classes: ClassRow[];
  students: StudentRow[];
  theme: Theme;
  materials: MaterialRow[];
  eventMaterials: { eventId: string; materialId: string }[];
}

type ViewMode = 'day' | 'week' | 'month' | 'agenda';

function CalendarScreen() {
  const { events, classes, students, theme, materials, eventMaterials } =
    useLoaderData() as CalendarLoaderData;
  const fetcher = useFetcher();
  const { t, lang } = useLang();
  const { months, monthsShort, dow } = getCal(lang);
  const [view, setView] = React.useState<ViewMode>('week');
  const [cursor, setCursor] = React.useState(() => new Date(TODAY));
  const [editor, setEditor] = React.useState<EventDraft | null>(null);
  const [themeOpen, setThemeOpen] = React.useState(false);

  const weekDays = React.useMemo(() => {
    const s = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [cursor]);
  const dayDays = React.useMemo(() => [new Date(cursor)], [cursor]);

  const go = (dir: number) => {
    if (view === 'month') setCursor((c) => new Date(c.getFullYear(), c.getMonth() + dir, 1));
    else if (view === 'week') setCursor((c) => addDays(c, dir * 7));
    else setCursor((c) => addDays(c, dir));
  };
  const title =
    view === 'month'
      ? `${months[cursor.getMonth()]} ${cursor.getFullYear()}`
      : view === 'week'
        ? `${monthsShort[weekDays[0].getMonth()]} ${weekDays[0].getDate()} – ${monthsShort[weekDays[6].getMonth()]} ${weekDays[6].getDate()}`
        : view === 'day'
          ? `${dow[cursor.getDay()]}, ${months[cursor.getMonth()]} ${cursor.getDate()}`
          : t('cal_next2');

  const openNew = (date?: string, start?: string) =>
    setEditor({
      title: '',
      date: date || iso(TODAY),
      start: start || '09:00',
      end: addMin(start || '09:00', 60),
      color: 'orange',
      classId: '',
      location: '',
      recurrence: 'none',
      notes: '',
    });
  const openEdit = (ev: EventRow) => setEditor({ ...ev, recurrence: ev.recurrence || 'none' });

  /**
   * A dropped event holds its new slot until the loader catches up, instead of snapping back to
   * where it was for the length of the round trip. Cleared whenever fresh rows arrive — success
   * or failure, since the route revalidates either way.
   */
  const [optimistic, setOptimistic] = React.useState<{
    id: string;
    date: string;
    start?: string;
    end?: string;
  } | null>(null);
  React.useEffect(() => setOptimistic(null), [events]);
  const shownEvents = React.useMemo(
    () =>
      optimistic
        ? events.map((e) =>
            e.id === optimistic.id
              ? {
                  ...e,
                  date: optimistic.date,
                  ...(optimistic.start ? { start: optimistic.start } : {}),
                  ...(optimistic.end ? { end: optimistic.end } : {}),
                }
              : e,
          )
        : events,
    [events, optimistic],
  );

  const { move, save, del, dialog } = useEventWrites({
    fetcher,
    editor,
    setEditor,
    onDirectMove: setOptimistic,
    classes,
  });

  const calStyle = {
    '--cal-bg': theme.bg,
    '--cal-grid': theme.gridLine,
    '--cal-today': theme.today,
    '--cal-header': theme.header,
  } as React.CSSProperties;

  return (
    <div className="content content--fill">
      <PageHeader
        title={t('cal_title')}
        subtitle={t('cal_sub')}
        actions={
          <div className="m-row">
            <CBtn
              variant="secondary"
              iconLeft={<MIcon name="palette" size={17} />}
              onClick={() => setThemeOpen(true)}
            >
              {t('cal_customize')}
            </CBtn>
            <CBtn
              variant="primary"
              iconLeft={<MIcon name="plus" size={18} />}
              onClick={() => openNew()}
            >
              {t('cal_new_event')}
            </CBtn>
          </div>
        }
      />
      <div className="cal-toolbar">
        <CIBtn label="Previous" variant="solid" size="sm" onClick={() => go(-1)}>
          <MIcon name="chevronLeft" size={18} />
        </CIBtn>
        <CIBtn label="Next" variant="solid" size="sm" onClick={() => go(1)}>
          <MIcon name="chevronRight" size={18} />
        </CIBtn>
        <CBtn variant="secondary" size="sm" onClick={() => setCursor(new Date(TODAY))}>
          {t('today')}
        </CBtn>
        <span className="title">{title}</span>
        <span style={{ flex: 1 }} />
        <CTabs
          value={view}
          onChange={(v: string) => setView(v as ViewMode)}
          tabs={[
            { id: 'day', label: t('view_day') },
            { id: 'week', label: t('view_week') },
            { id: 'month', label: t('view_month') },
            { id: 'agenda', label: t('view_agenda') },
          ]}
        />
      </div>
      <div className="calwrap" style={calStyle}>
        {theme.bgImage && (
          <div
            className="calwrap__bgimg"
            style={{ backgroundImage: `url(${theme.bgImage})`, opacity: theme.bgOpacity }}
          />
        )}
        {view === 'month' && (
          <MonthView
            cursor={cursor}
            events={shownEvents}
            onPick={openEdit}
            onCreate={(dk) => openNew(dk)}
            onMove={(ev, dk) => move(ev, dk)}
          />
        )}
        {view === 'week' && (
          <TimeGrid
            cursor={cursor}
            days={weekDays}
            events={shownEvents}
            onPick={openEdit}
            onCreate={openNew}
            onMove={move}
          />
        )}
        {view === 'day' && (
          <TimeGrid
            cursor={cursor}
            days={dayDays}
            events={shownEvents}
            onPick={openEdit}
            onCreate={openNew}
            onMove={move}
          />
        )}
        {view === 'agenda' && <AgendaView cursor={cursor} events={shownEvents} onPick={openEdit} />}
      </div>
      <EventModal
        open={!!editor}
        onClose={() => setEditor(null)}
        draft={editor}
        onSave={save}
        onDelete={del}
        classes={classes}
        students={students}
        materials={materials}
        eventMaterials={eventMaterials}
        events={events}
      />
      {dialog}
      {themeOpen && <CalendarThemeDrawer onClose={() => setThemeOpen(false)} />}
    </div>
  );
}

export { CalendarScreen, fmtTime, expandEvents, toMin, MONTHS, DOW };
