import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { useStore } from './store.jsx';
import { Modal, MSelect, ColorPicker, PageHeader, Empty } from './ui.jsx';
import { colorOf, iso, addDays, TODAY } from './lib/core.js';
import { CalendarThemePanel } from './screens-extra.jsx';
import { useLang, getCal } from './lib/i18n.jsx';

// app/calendar.jsx — Calendar: month / week / day / agenda, create/edit, drag-to-reschedule
const { Button: CBtn, IconButton: CIBtn, Tabs: CTabs } = DS;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7am .. 8pm
const HR_H = 56;

const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const fmtTime = (t) => {
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')}${ap}` : `${h}${ap}`;
};
const addMin = (t, delta) => {
  let total = toMin(t) + delta;
  total = Math.max(0, Math.min(24 * 60 - 1, total));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const startOfWeek = (d) => {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};

// expand recurring weekly events into concrete dates within a range
function expandEvents(events, rangeStart, rangeEnd) {
  const out = [];
  for (const ev of events) {
    const base = parseISO(ev.date);
    if (ev.recurrence === 'weekly') {
      let d = new Date(base);
      // walk back to before range, then forward
      while (d > rangeStart) d = addDays(d, -7);
      while (d <= rangeEnd) {
        if (d >= rangeStart) out.push({ ...ev, date: iso(d), _instance: iso(d) !== ev.date });
        d = addDays(d, 7);
      }
    } else if (ev.recurrence === 'daily') {
      let d = new Date(rangeStart);
      while (d <= rangeEnd) {
        out.push({ ...ev, date: iso(d), _instance: iso(d) !== ev.date });
        d = addDays(d, 1);
      }
    } else {
      if (base >= rangeStart && base <= rangeEnd) out.push({ ...ev });
    }
  }
  return out;
}

// ---- Event editor modal ----
function EventModal({ open, onClose, draft, onSave, onDelete, classes }) {
  const { t } = useLang();
  const [f, setF] = React.useState(draft || {});
  React.useEffect(() => {
    setF(draft || {});
  }, [draft, open]);
  if (!open) return null;
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const isNew = !f.id;
  const classOpts = [
    { value: '', label: t('ev_class_personal') },
    ...classes.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? t('ev_new') : t('ev_edit')}
      width={540}
      footer={
        <>
          {!isNew && (
            <CBtn
              variant="danger"
              onClick={() => onDelete(f.id)}
              iconLeft={<MIcon name="trash" size={16} />}
            >
              {t('delete')}
            </CBtn>
          )}
          <span style={{ flex: 1 }} />
          <CBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </CBtn>
          <CBtn variant="primary" onClick={() => onSave(f)}>
            {isNew ? t('ev_add') : t('save')}
          </CBtn>
        </>
      }
    >
      <div className="mochi-field">
        <label className="mochi-field__label">{t('ev_title')}</label>
        <input
          className="mochi-input"
          placeholder={t('ev_title_ph')}
          value={f.title || ''}
          autoFocus
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div className="m-grid cols-3" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('ev_date')}</label>
          <input
            type="date"
            className="mochi-input"
            value={f.date || ''}
            onChange={(e) => set('date', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('ev_start')}</label>
          <input
            type="time"
            className="mochi-input"
            value={f.start || ''}
            onChange={(e) => set('start', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('ev_end')}</label>
          <input
            type="time"
            className="mochi-input"
            value={f.end || ''}
            onChange={(e) => set('end', e.target.value)}
          />
        </div>
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MSelect
          label={t('class')}
          value={f.classId || ''}
          onChange={(v) => {
            set('classId', v);
            const c = classes.find((x) => x.id === v);
            if (c) set('color', c.color);
          }}
          options={classOpts}
        />
        <MSelect
          label={t('ev_repeat')}
          value={f.recurrence || 'none'}
          onChange={(v) => set('recurrence', v)}
          options={[
            { value: 'none', label: t('ev_repeat_none') },
            { value: 'daily', label: t('ev_repeat_daily') },
            { value: 'weekly', label: t('ev_repeat_weekly') },
          ]}
        />
      </div>
      <div className="mochi-field">
        <label className="mochi-field__label">{t('ev_location')}</label>
        <input
          className="mochi-input"
          placeholder={t('ev_location_ph')}
          value={f.location || ''}
          onChange={(e) => set('location', e.target.value)}
        />
      </div>
      <ColorPicker
        label={t('color')}
        value={f.color || 'orange'}
        onChange={(v) => set('color', v)}
      />
    </Modal>
  );
}

// ---- Month view ----
function MonthView({ cursor, events, onPick, onCreate }) {
  const { t, lang } = useLang();
  const { dowMon } = getCal(lang);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const rangeEnd = cells[41];
  const all = expandEvents(events, gridStart, rangeEnd);
  const today = iso(TODAY);

  return (
    <div>
      <div className="month">
        {dowMon.map((d, di) => (
          <div key={di} className="month__dow">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          const dk = iso(d);
          const out = d.getMonth() !== cursor.getMonth();
          const dayEvents = all
            .filter((e) => e.date === dk)
            .sort((a, b) => toMin(a.start) - toMin(b.start));
          return (
            <div
              key={i}
              className={'month__cell' + (out ? ' is-out' : '') + (dk === today ? ' is-today' : '')}
              onClick={() => onCreate(dk)}
            >
              <div className="month__date">{d.getDate()}</div>
              {dayEvents.slice(0, 3).map((e, j) => {
                const c = colorOf(e.color);
                return (
                  <div
                    key={j}
                    className="mpill"
                    style={{ background: c.soft, color: c.ink }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onPick(e);
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 9,
                        background: c.base,
                        flexShrink: 0,
                      }}
                    />
                    <span className="mpill__time">{fmtTime(e.start)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
                  </div>
                );
              })}
              {dayEvents.length > 3 && (
                <div className="mmore">{t('cal_more', { n: dayEvents.length - 3 })}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Time grid (week or day) ----
function TimeGrid({ cursor: _cursor, days, events, onPick, onCreate, onMove }) {
  const { lang } = useLang();
  const { dow, dowMon } = getCal(lang);
  const dayList = days;
  const rangeStart = dayList[0];
  const rangeEnd = dayList[dayList.length - 1];
  const all = expandEvents(events, rangeStart, rangeEnd);
  const today = iso(TODAY);
  const gridTpl = `64px repeat(${dayList.length}, 1fr)`;
  const dayStart = HOURS[0] * 60;
  const [drag, setDrag] = React.useState(null);
  const bodyRef = React.useRef(null);

  const yFor = (min) => ((min - dayStart) / 60) * HR_H;

  // now-line
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = nowMin >= dayStart && nowMin <= (HOURS[HOURS.length - 1] + 1) * 60;

  const onColDown = (e, dk) => {
    // click on empty space → create at that hour
    if (e.target.closest('.tev')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = dayStart + Math.floor(y / HR_H) * 60;
    onCreate(dk, addMin('00:00', min));
  };

  const startDrag = (e, ev) => {
    e.stopPropagation();
    const rect = bodyRef.current.getBoundingClientRect();
    setDrag({
      ev,
      offY: e.clientY,
      origStart: ev.start,
      origEnd: ev.end,
      colW: (rect.width - 64) / dayList.length,
      rectLeft: rect.left,
      preview: null,
    });
  };

  React.useEffect(() => {
    if (!drag) return;
    const onMoveE = (e) => {
      const dyMin = Math.round((((e.clientY - drag.offY) / HR_H) * 60) / 15) * 15;
      const colIdx = Math.max(
        0,
        Math.min(dayList.length - 1, Math.floor((e.clientX - drag.rectLeft - 64) / drag.colW)),
      );
      setDrag((d) => ({ ...d, preview: { dyMin, colIdx } }));
    };
    const onUp = () => {
      setDrag((d) => {
        if (d && d.preview) {
          const dur = toMin(d.origEnd) - toMin(d.origStart);
          const ns = addMin(d.origStart, d.preview.dyMin);
          const ne = addMin(ns, dur);
          onMove(d.ev, iso(dayList[d.preview.colIdx]), ns, ne);
        }
        return null;
      });
    };
    window.addEventListener('mousemove', onMoveE);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMoveE);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, dayList, onMove]);

  return (
    <div className="tgrid" style={{ '--hr-h': HR_H + 'px' }}>
      <div className="tgrid__head" style={{ gridTemplateColumns: gridTpl }}>
        <div className="tgrid__corner" />
        {dayList.map((d, i) => {
          const isToday = iso(d) === today;
          return (
            <div key={i} className={'tgrid__dayhd' + (isToday ? ' is-today' : '')}>
              <div className="w">{dayList.length > 1 ? dowMon[i % 7] : dow[d.getDay()]}</div>
              {isToday ? (
                <div className="ddot">{d.getDate()}</div>
              ) : (
                <div className="d">{d.getDate()}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="tgrid__body" style={{ gridTemplateColumns: gridTpl }} ref={bodyRef}>
        <div className="tgrid__times">
          {HOURS.map((h) => (
            <div key={h} className="tgrid__timelabel">
              {fmtTime(`${h}:00`)}
            </div>
          ))}
        </div>
        {dayList.map((d, ci) => {
          const dk = iso(d);
          const isToday = dk === today;
          const dayEvents = all.filter((e) => e.date === dk);
          return (
            <div
              key={ci}
              className={'tgrid__col' + (isToday ? ' is-today' : '')}
              onMouseDown={(e) => onColDown(e, dk)}
            >
              {HOURS.map((h) => (
                <div key={h} className="tgrid__hourline" />
              ))}
              {showNow && isToday && (
                <div className="tgrid__nowline" style={{ top: yFor(nowMin) }} />
              )}
              {dayEvents.map((e, j) => {
                const c = colorOf(e.color);
                let top = yFor(toMin(e.start));
                let height = ((toMin(e.end) - toMin(e.start)) / 60) * HR_H - 3;
                const isDragging = drag && drag.ev.id === e.id && drag.ev.date === e.date;
                if (isDragging && drag.preview) {
                  top = yFor(toMin(addMin(drag.origStart, drag.preview.dyMin)));
                }
                if (isDragging && drag.preview && drag.preview.colIdx !== ci) return null;
                return (
                  <div
                    key={j}
                    className={'tev' + (isDragging ? ' is-dragging' : '')}
                    style={{
                      top,
                      height: Math.max(height, 24),
                      background: c.soft,
                      borderLeftColor: c.base,
                    }}
                    onMouseDown={(ev) => startDrag(ev, e)}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (!drag) onPick(e);
                    }}
                  >
                    <div className="tev__t">{e.title}</div>
                    {height > 34 && (
                      <div className="tev__time" style={{ color: c.ink }}>
                        {`${fmtTime(e.start)} – ${fmtTime(e.end)}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Agenda view ----
function AgendaView({ cursor: _cursor, events, onPick }) {
  const { t, lang } = useLang();
  const { dow, monthsShort } = getCal(lang);
  const start = TODAY;
  const end = addDays(start, 13);
  const all = expandEvents(events, start, end);
  const today = iso(start);
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(start, i);
    const dk = iso(d);
    const list = all.filter((e) => e.date === dk).sort((a, b) => toMin(a.start) - toMin(b.start));
    if (list.length) days.push({ d, dk, list });
  }
  if (!days.length)
    return <Empty icon="calendar" title={t('agenda_empty_title')} sub={t('agenda_empty_sub')} />;
  return (
    <div className="agenda">
      {days.map(({ d, dk, list }) => (
        <div key={dk} className="agenda__day">
          <div className={'agenda__date' + (dk === today ? ' is-today' : '')}>
            <div className="agenda__dwk">{dk === today ? t('today') : dow[d.getDay()]}</div>
            <div className="agenda__dnum">{d.getDate()}</div>
            <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
              {monthsShort[d.getMonth()]}
            </div>
          </div>
          <div className="agenda__events">
            {list.map((e, j) => {
              const c = colorOf(e.color);
              return (
                <div
                  key={j}
                  className="aev"
                  style={{ background: c.soft, borderLeftColor: c.base }}
                  onClick={() => onPick(e)}
                >
                  <div className="aev__time">{fmtTime(e.start)}</div>
                  <div style={{ flex: 1 }}>
                    <div className="aev__t">{e.title}</div>
                    {e.location && (
                      <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                        {e.location}
                      </div>
                    )}
                  </div>
                  {e.recurrence !== 'none' && (
                    <MIcon name="repeat" size={14} style={{ color: c.ink }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Customize drawer (slide-in panel, not a modal) ----
// Renders the theme editor as a right-hand drawer so internal clicks never
// risk dismissing it. Closes only via the X button, the backdrop, or Escape.
function CalendarThemeDrawer({ onClose }) {
  const { t } = useLang();
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="drawer-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer__head">
          <h3 className="drawer__title">{t('theme_title')}</h3>
          <CIBtn label={t('close')} size="sm" onClick={onClose}>
            <MIcon name="x" size={18} />
          </CIBtn>
        </div>
        <div className="drawer__body">
          <CalendarThemePanel />
        </div>
        <div className="drawer__foot">
          <CBtn variant="primary" onClick={onClose}>
            {t('done')}
          </CBtn>
        </div>
      </aside>
    </div>
  );
}

// ---- Calendar screen ----
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
