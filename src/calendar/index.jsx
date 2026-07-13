import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useStore } from '../store.jsx';
import { PageHeader } from '../ui.jsx';
import { colorOf, iso, addDays, TODAY } from '../lib/core.js';
import { useLang, getCal } from '../lib/i18n.jsx';
import { EventModal } from './event-modal.jsx';
import { MonthView } from './month-view.jsx';
import { TimeGrid } from './time-grid.jsx';
import { AgendaView } from './agenda-view.jsx';
import { CalendarThemeDrawer } from './theme-drawer.jsx';
import { startOfWeek, addMin, fmtTime, toMin, MONTHS, DOW, expandEvents } from './utils.js';

const { Button: CBtn, IconButton: CIBtn, Tabs: CTabs } = DS;

function CalendarScreen() {
  const { data, add, update, remove } = useStore();
  const { t, lang } = useLang();
  const { months, monthsShort, dow } = getCal(lang);
  const [view, setView] = React.useState('week');
  const [cursor, setCursor] = React.useState(() => new Date(TODAY));
  const [editor, setEditor] = React.useState(null); // draft or null
  const [themeOpen, setThemeOpen] = React.useState(false);
  const theme = data.theme;

  const weekDays = React.useMemo(() => {
    const s = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [cursor]);
  const dayDays = React.useMemo(() => [new Date(cursor)], [cursor]);

  const go = (dir) => {
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

  const openNew = (date, start) =>
    setEditor({
      title: '',
      date: date || iso(TODAY),
      start: start || '09:00',
      end: addMin(start || '09:00', 60),
      color: 'orange',
      classId: '',
      location: '',
      recurrence: 'none',
    });
  const openEdit = (ev) => setEditor({ ...ev, recurrence: ev.recurrence || 'none' });
  const save = (f) => {
    if (!f.title.trim()) f.title = t('ev_untitled');
    if (f.id) update('events', f.id, f);
    else add('events', f);
    setEditor(null);
  };
  const del = (id) => {
    remove('events', id);
    setEditor(null);
  };
  const move = (ev, newDate, ns, ne) => {
    if (ev.id)
      update('events', ev.id, {
        date: ev.recurrence && ev.recurrence !== 'none' ? ev.date : newDate,
        start: ns,
        end: ne,
        ...(ev.recurrence && ev.recurrence !== 'none' ? {} : { date: newDate }),
      });
  };

  const calStyle = {
    '--cal-bg': theme.bg,
    '--cal-grid': theme.gridLine,
    '--cal-today': theme.today,
    '--cal-header': theme.header,
  };

  return (
    <div className="content">
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
          onChange={setView}
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
            events={data.events}
            onPick={openEdit}
            onCreate={(dk) => openNew(dk)}
          />
        )}
        {view === 'week' && (
          <TimeGrid
            cursor={cursor}
            days={weekDays}
            events={data.events}
            onPick={openEdit}
            onCreate={openNew}
            onMove={move}
          />
        )}
        {view === 'day' && (
          <TimeGrid
            cursor={cursor}
            days={dayDays}
            events={data.events}
            onPick={openEdit}
            onCreate={openNew}
            onMove={move}
          />
        )}
        {view === 'agenda' && <AgendaView cursor={cursor} events={data.events} onPick={openEdit} />}
      </div>
      <div className="legend">
        {data.classes.map((c) => {
          const col = colorOf(c.color);
          return (
            <div key={c.id} className="legend__item">
              <span className="legend__dot" style={{ background: col.base }} />
              {c.name}
            </div>
          );
        })}
      </div>
      <EventModal
        open={!!editor}
        onClose={() => setEditor(null)}
        draft={editor}
        onSave={save}
        onDelete={del}
        classes={data.classes}
      />
      {themeOpen && <CalendarThemeDrawer onClose={() => setThemeOpen(false)} />}
    </div>
  );
}

export { CalendarScreen, fmtTime, expandEvents, toMin, MONTHS, DOW };
