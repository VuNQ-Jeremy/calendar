import React from 'react';
import { colorOf, iso, addDays, TODAY } from '../lib/core.js';
import { useLang, getCal } from '../lib/i18n.jsx';
import { expandEvents, startOfWeek, toMin, fmtTime } from './utils.js';
import type { EventRow } from '../../server/services/events.js';

interface MonthViewProps {
  cursor: Date;
  events: EventRow[];
  onPick: (ev: EventRow) => void;
  onCreate: (dk: string) => void;
}

export function MonthView({ cursor, events, onPick, onCreate }: MonthViewProps) {
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
            .sort((a, b) => toMin(a.start ?? '00:00') - toMin(b.start ?? '00:00'));
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
                    <span className="mpill__time">{fmtTime(e.start ?? '00:00')}</span>
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
