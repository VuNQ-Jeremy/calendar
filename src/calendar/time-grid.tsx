import React from 'react';
import { colorOf, iso, TODAY } from '../lib/core.js';
import { useLang, getCal } from '../lib/i18n.jsx';
import { expandEvents, toMin, fmtTime, addMin, HOURS, HR_H } from './utils.js';
import type { EventRow } from '../../server/services/events.js';
import type { ExpandedEvent } from './utils.js';

/** Below this many pixels of travel the gesture is still a click, not a drag. */
const DRAG_THRESHOLD = 4;

/** Minutes a dragged block snaps to — the grid the event dialog's TimePicker steps on (ui.tsx). */
const SNAP_MIN = 15;

interface DragState {
  ev: ExpandedEvent;
  /** Pointer position at mousedown, the origin both deltas are measured from. */
  offX: number;
  offY: number;
  origStart: string;
  origEnd: string;
  /** Scroll offset at mousedown: wheeling mid-drag moves content under a still pointer. */
  scrollTop0: number;
  /** Null until the threshold is passed — its presence is what makes this a drag. */
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

  /**
   * A drop is followed by a click on the event that was just dragged. Swallow exactly that one:
   * the click dispatches synchronously after mouseup, well before this timeout clears the flag,
   * so a real drop never opens the editor and a later genuine click still does.
   */
  const suppressClickRef = React.useRef(false);
  const suppressNextClick = () => {
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const startDrag = (e: React.MouseEvent, ev: ExpandedEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault(); // no text selection while dragging
    setDrag({
      ev,
      offX: e.clientX,
      offY: e.clientY,
      origStart: ev.start ?? '00:00',
      origEnd: ev.end ?? '01:00',
      scrollTop0: gridRef.current?.scrollTop ?? 0,
      preview: null,
    });
  };

  React.useEffect(() => {
    if (!drag) return;
    const onMoveE = (e: MouseEvent) => {
      const body = bodyRef.current;
      if (!body) return;
      if (
        !drag.preview &&
        Math.hypot(e.clientX - drag.offX, e.clientY - drag.offY) < DRAG_THRESHOLD
      )
        return;
      // Measured fresh on every move rather than once at mousedown, so a resize mid-drag cannot
      // skew which column the pointer reads as.
      const rect = body.getBoundingClientRect();
      const colW = (rect.width - 64) / dayList.length;
      const scrollDelta = (gridRef.current?.scrollTop ?? 0) - drag.scrollTop0;
      const s0 = toMin(drag.origStart);
      const dur = toMin(drag.origEnd) - s0;
      const dyRaw = ((e.clientY - drag.offY + scrollDelta) / HR_H) * 60;
      // Snap where the block LANDS, not how far it travelled. Snapping the delta preserves any
      // odd offset the event already had, so a 9:33 event would move to 9:48 and never reach the
      // grid; snapping the destination settles it on 9:30 or 9:45 the first time it is dragged.
      let dyMin = Math.round((s0 + dyRaw) / SNAP_MIN) * SNAP_MIN - s0;
      dyMin = Math.max(-s0, Math.min(24 * 60 - dur - s0, dyMin)); // keep the block inside the day
      const colIdx = Math.max(
        0,
        Math.min(dayList.length - 1, Math.floor((e.clientX - rect.left - 64) / colW)),
      );
      setDrag((d) => (d ? { ...d, preview: { dyMin, colIdx } } : d));
    };
    const onUp = () => {
      setDrag((d) => {
        if (d && d.preview) {
          suppressNextClick();
          const nd = iso(dayList[d.preview.colIdx]);
          const ns = addMin(d.origStart, d.preview.dyMin);
          const dur = toMin(d.origEnd) - toMin(d.origStart);
          // Dropped back where it started: nothing to save, and no scope question to ask.
          if (nd !== d.ev.date || ns !== d.origStart) onMove(d.ev, nd, ns, addMin(ns, dur));
        }
        return null;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      suppressNextClick();
      setDrag(null); // onUp then finds no drag and commits nothing
    };
    window.addEventListener('mousemove', onMoveE);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMoveE);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag, dayList, onMove]);

  return (
    <div
      className={'tgrid' + (drag?.preview ? ' is-dragging' : '')}
      ref={gridRef}
      style={{ '--hr-h': HR_H + 'px' } as React.CSSProperties}
    >
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
                const top = yFor(toMin(e.start ?? '00:00'));
                const height =
                  ((toMin(e.end ?? '01:00') - toMin(e.start ?? '00:00')) / 60) * HR_H - 3;
                // The block being dragged stays put and dims; the ghost below shows where it
                // would land, in whichever column that is.
                const isDragging = !!(
                  drag?.preview &&
                  drag.ev.id === e.id &&
                  drag.ev.date === e.date
                );
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
                      if (suppressClickRef.current) return;
                      onPick(e);
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
              {drag?.preview?.colIdx === ci &&
                (() => {
                  const gs = addMin(drag.origStart, drag.preview.dyMin);
                  const dur = toMin(drag.origEnd) - toMin(drag.origStart);
                  const gh = (dur / 60) * HR_H - 3;
                  const c = colorOf(drag.ev.color);
                  return (
                    <div
                      className="tev tev--ghost"
                      style={{
                        top: yFor(toMin(gs)),
                        height: Math.max(gh, 24),
                        background: c.soft,
                        borderLeftColor: c.base,
                      }}
                    >
                      <div className="tev__t">{drag.ev.title}</div>
                      {gh > 34 && (
                        <div className="tev__time" style={{ color: c.ink }}>
                          {`${fmtTime(gs)} – ${fmtTime(addMin(gs, dur))}`}
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
