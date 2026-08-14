import React from 'react';
import { colorOf, iso, addDays, TODAY } from '../lib/core.js';
import { useLang, getCal } from '../lib/i18n.jsx';
import { expandEvents, startOfWeek, toMin, fmtTime } from './utils.js';
import type { EventRow } from '../../server/services/events.js';
import type { ExpandedEvent } from './utils.js';

/** Below this many pixels of travel the gesture is still a click, not a drag. */
const DRAG_THRESHOLD = 4;

interface MonthDrag {
  ev: ExpandedEvent;
  startX: number;
  startY: number;
  /** Threshold passed — the presence of this is what makes the gesture a drag. */
  moved: boolean;
  /** Day key of the cell under the pointer, or null when it is over nothing droppable. */
  overDk: string | null;
  x: number;
  y: number;
}

interface MonthViewProps {
  cursor: Date;
  events: EventRow[];
  onPick: (ev: EventRow) => void;
  onCreate: (dk: string) => void;
  /** Date-only: a month cell has no time axis, so the event keeps the times it had. */
  onMove: (ev: ExpandedEvent, newDate: string) => void;
}

export function MonthView({ cursor, events, onPick, onCreate, onMove }: MonthViewProps) {
  const { t, lang } = useLang();
  const { dowMon } = getCal(lang);
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const rangeEnd = cells[41];
  const all = expandEvents(events, gridStart, rangeEnd);
  const today = iso(TODAY);

  const [drag, setDrag] = React.useState<MonthDrag | null>(null);

  /** Swallow the click that follows a drop — see the same guard in time-grid.tsx. */
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
    e.preventDefault();
    setDrag({
      ev,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      overDk: null,
      x: e.clientX,
      y: e.clientY,
    });
  };

  React.useEffect(() => {
    if (!drag) return;
    const onMoveE = (e: MouseEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const moved =
          d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD;
        // Hit-testing the viewport rather than measuring cell rects: the month grid scrolls and
        // its weekday header is sticky, and `closest` resolves a hit on a pill or a date number
        // up to the cell that owns it. The ghost is pointer-events:none, so it never shadows one.
        const cell = moved
          ? (document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest('.month__cell[data-dk]') as HTMLElement | null)
          : null;
        return { ...d, moved, overDk: cell?.dataset.dk ?? null, x: e.clientX, y: e.clientY };
      });
    };
    const onUp = () => {
      setDrag((d) => {
        if (d?.moved) {
          suppressNextClick();
          // Same cell, or released over the header/gutter/outside: nothing to save.
          if (d.overDk && d.overDk !== d.ev.date) onMove(d.ev, d.overDk);
        }
        return null;
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      suppressNextClick();
      setDrag(null);
    };
    window.addEventListener('mousemove', onMoveE);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMoveE);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag, onMove]);

  return (
    <div>
      <div className={'month' + (drag?.moved ? ' is-dragging' : '')}>
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
              data-dk={dk}
              className={
                'month__cell' +
                (out ? ' is-out' : '') +
                (dk === today ? ' is-today' : '') +
                (drag?.moved && drag.overDk === dk ? ' is-droptarget' : '')
              }
              onClick={() => {
                if (suppressClickRef.current) return;
                onCreate(dk);
              }}
            >
              <div className="month__date">{d.getDate()}</div>
              {dayEvents.slice(0, 3).map((e, j) => {
                const c = colorOf(e.color);
                const isDragging = !!(
                  drag?.moved &&
                  drag.ev.id === e.id &&
                  drag.ev.date === e.date
                );
                return (
                  <div
                    key={j}
                    className={'mpill' + (isDragging ? ' is-dragging' : '')}
                    style={{ background: c.soft, color: c.ink }}
                    onMouseDown={(ev) => startDrag(ev, e)}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (suppressClickRef.current) return;
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
      {drag?.moved &&
        (() => {
          const c = colorOf(drag.ev.color);
          return (
            <div
              className="mpill mpill--ghost"
              style={{ left: drag.x + 12, top: drag.y + 12, background: c.soft, color: c.ink }}
            >
              <span
                style={{ width: 6, height: 6, borderRadius: 9, background: c.base, flexShrink: 0 }}
              />
              <span className="mpill__time">{fmtTime(drag.ev.start ?? '00:00')}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{drag.ev.title}</span>
            </div>
          );
        })()}
    </div>
  );
}
