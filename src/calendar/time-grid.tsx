import React from 'react';
import { colorOf, iso, TODAY } from '../lib/core.js';
import { useLang, getCal } from '../lib/i18n.jsx';
import { expandEvents, toMin, fmtTime, addMin, HOURS, HR_H } from './utils.js';
import type { EventRow } from '../../server/services/events.js';
import type { ExpandedEvent } from './utils.js';

interface DragState {
  ev: ExpandedEvent;
  offY: number;
  origStart: string;
  origEnd: string;
  colW: number;
  rectLeft: number;
  preview: { dyMin: number; colIdx: number } | null;
}

interface TimeGridProps {
  cursor?: Date;
  days: Date[];
  events: EventRow[];
  onPick: (ev: ExpandedEvent) => void;
  onCreate: (dk: string, start: string) => void;
  onMove: (ev: ExpandedEvent, newDate: string, ns: string, ne: string) => void;
}

export function TimeGrid({
  cursor: _cursor,
  days,
  events,
  onPick,
  onCreate,
  onMove,
}: TimeGridProps) {
  const { lang } = useLang();
  const { dow, dowMon } = getCal(lang);
  const dayList = days;
  const rangeStart = dayList[0];
  const rangeEnd = dayList[dayList.length - 1];
  const all = expandEvents(events, rangeStart, rangeEnd);
  const today = iso(TODAY);
  const gridTpl = `64px repeat(${dayList.length}, 1fr)`;
  const dayStart = HOURS[0] * 60;
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);

  // focus the grid on the earliest event in the visible range (fall back to now),
  // keeping ~1h of context above it; refocus when navigating to another range
  const rangeKey = iso(rangeStart) + ':' + dayList.length;
  const earliestMin = all.length ? Math.min(...all.map((e) => toMin(e.start ?? '00:00'))) : null;
  React.useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const now = new Date();
    const anchor = earliestMin ?? now.getHours() * 60 + now.getMinutes();
    el.scrollTop = Math.max(0, ((anchor - 60) / 60) * HR_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, earliestMin]);

  const yFor = (min: number) => ((min - dayStart) / 60) * HR_H;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = nowMin >= dayStart && nowMin <= (HOURS[HOURS.length - 1] + 1) * 60;

  const onColDown = (e: React.MouseEvent<HTMLDivElement>, dk: string) => {
    if ((e.target as Element).closest('.tev')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = dayStart + Math.floor(y / HR_H) * 60;
    onCreate(dk, addMin('00:00', min));
  };

  const startDrag = (e: React.MouseEvent, ev: ExpandedEvent) => {
    e.stopPropagation();
    const rect = bodyRef.current!.getBoundingClientRect();
    setDrag({
      ev,
      offY: e.clientY,
      origStart: ev.start ?? '00:00',
      origEnd: ev.end ?? '01:00',
      colW: (rect.width - 64) / dayList.length,
      rectLeft: rect.left,
      preview: null,
    });
  };

  React.useEffect(() => {
    if (!drag) return;
    const onMoveE = (e: MouseEvent) => {
      const dyMin = Math.round((((e.clientY - drag.offY) / HR_H) * 60) / 15) * 15;
      const colIdx = Math.max(
        0,
        Math.min(dayList.length - 1, Math.floor((e.clientX - drag.rectLeft - 64) / drag.colW)),
      );
      setDrag((d) => (d ? { ...d, preview: { dyMin, colIdx } } : d));
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
    <div className="tgrid" ref={gridRef} style={{ '--hr-h': HR_H + 'px' } as React.CSSProperties}>
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
                let top = yFor(toMin(e.start ?? '00:00'));
                let height =
                  ((toMin(e.end ?? '01:00') - toMin(e.start ?? '00:00')) / 60) * HR_H - 3;
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
                        {`${fmtTime(e.start ?? '00:00')} – ${fmtTime(e.end ?? '01:00')}`}
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
