import React from 'react';
import { MIcon } from '../icons.jsx';
import { colorOf, iso, addDays, TODAY } from '../lib/core.js';
import { useLang, getCal } from '../lib/i18n.jsx';
import { Empty } from '../ui.jsx';
import { expandEvents, toMin, fmtTime } from './utils.js';

export function AgendaView({ cursor: _cursor, events, onPick }) {
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
