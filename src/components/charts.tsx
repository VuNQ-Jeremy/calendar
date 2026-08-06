import React from 'react';

// viewBox width; SVG scales to container. Text/strokes scale down with a wider
// viewBox — 900 keeps the 11-unit labels near actual 11px at typical card widths.
const W = 900;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

export interface ChartPoint {
  x: string; // ISO date
  y: number;
  label?: string; // e.g. exam type — goes into the <title> tooltip
}

export function ProgressLineChart({
  points,
  yMin = 0,
  yMax = 10,
  width = W,
  height = 220,
  fit = false,
  color = 'var(--brand)',
  colorFor,
  formatX,
  ariaLabel,
  emptyLabel,
}: {
  points: ChartPoint[];
  yMin?: number;
  yMax?: number;
  /**
   * viewBox width. The SVG always fills its container, so this is really a text-size dial:
   * the whole drawing scales by containerWidth / width, and the 11-unit labels with it. Pass
   * something smaller than the default when the chart sits in a narrow column, or the labels
   * shrink with it. In `fit` mode this is only the pre-measurement fallback.
   */
  width?: number;
  /** viewBox height — in `fit` mode, the minimum box height instead. */
  height?: number;
  /**
   * Size to the box rather than to the aspect ratio. Off, the rendered height is
   * containerWidth × height/width, which in a wide container overflows whatever vertical
   * space the chart was given. On, the measured pixel box becomes the viewBox: one unit is
   * one pixel, so labels are always their literal font size and the drawing cannot outgrow
   * its container. Needs a parent that gives the chart a height (a flex column).
   */
  fit?: boolean;
  color?: string;
  /** Per-value colour (e.g. the score bands). Applies to the dots and to each line segment. */
  colorFor?: (y: number) => string;
  formatX: (iso: string) => string;
  ariaLabel: string;
  emptyLabel?: string;
}) {
  // Callback ref, not useRef: the empty state renders no box at all, so the observer has to
  // re-attach when points arrive and the node mounts.
  const [boxEl, setBoxEl] = React.useState<HTMLDivElement | null>(null);
  const [box, setBox] = React.useState<{ w: number; h: number } | null>(null);
  React.useLayoutEffect(() => {
    if (!fit || !boxEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      if (w > 0 && h > 0) setBox({ w: Math.round(w), h: Math.round(h) });
    });
    ro.observe(boxEl);
    return () => ro.disconnect();
  }, [fit, boxEl]);

  if (!points.length) {
    return (
      <div className="m-muted" style={{ padding: '32px 0', textAlign: 'center' }}>
        {emptyLabel}
      </div>
    );
  }
  const vw = fit && box ? box.w : width;
  const vh = fit && box ? box.h : height;
  const innerW = vw - PAD.left - PAD.right;
  const innerH = vh - PAD.top - PAD.bottom;
  // Even index spacing (ordinal x): test dates are irregular; equal spacing reads better.
  const px = (i: number) =>
    PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const py = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const gridVals: number[] = [];
  for (let v = yMin; v <= yMax; v += 2) gridVals.push(v);
  const line = points.map((p, i) => `${px(i)},${py(p.y)}`).join(' ');
  const area = `${px(0)},${py(yMin)} ${line} ${px(points.length - 1)},${py(yMin)}`;
  // A segment takes the colour of the point it arrives at — the reading is "where this got to",
  // so a climb into the green band turns green as it lands there.
  const dotColor = (i: number) => (colorFor ? colorFor(points[i].y) : color);
  // ~one x label per 150 viewBox units (6 at the default width): always first and last.
  const maxLabels = Math.max(3, Math.round(vw / 150));
  const step = Math.max(1, Math.ceil(points.length / maxLabels));
  const showX = (i: number) => i === 0 || i === points.length - 1 || i % step === 0;
  // The end points sit on the plot edges, where a centred label would run half its width
  // outside the viewBox and get clipped — tuck those two inwards. A lone point is centred.
  const anchorX = (i: number) => {
    if (points.length === 1) return 'middle';
    if (i === 0) return 'start';
    return i === points.length - 1 ? 'end' : 'middle';
  };

  const svg = (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      style={
        fit
          ? { width: '100%', height: '100%', display: 'block' }
          : { width: '100%', height: 'auto', display: 'block' }
      }
      role="img"
      aria-label={ariaLabel}
    >
      {gridVals.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={vw - PAD.right}
            y1={py(v)}
            y2={py(v)}
            stroke="var(--line, #ECE0CF)"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={py(v) + 4}
            textAnchor="end"
            fontSize={11}
            fill="var(--text-muted)"
          >
            {v}
          </text>
        </g>
      ))}
      {points.length > 1 && <polygon points={area} fill={color} opacity={0.08} />}
      {points.length > 1 &&
        (colorFor ? (
          points
            .slice(1)
            .map((p, i) => (
              <line
                key={`s${i}`}
                x1={px(i)}
                y1={py(points[i].y)}
                x2={px(i + 1)}
                y2={py(p.y)}
                stroke={dotColor(i + 1)}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            ))
        ) : (
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={px(i)}
          cy={py(p.y)}
          r={4.5}
          fill={dotColor(i)}
          stroke="#fff"
          strokeWidth={1.5}
        >
          <title>{`${formatX(p.x)} — ${p.y}${p.label ? ` (${p.label})` : ''}`}</title>
        </circle>
      ))}
      {points.map((p, i) => (
        <text
          key={`v${i}`}
          x={px(i)}
          y={py(p.y) - 10}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="var(--text-strong, #3A312A)"
        >
          {p.y}
        </text>
      ))}
      {points.map((p, i) =>
        showX(i) ? (
          <text
            key={`x${i}`}
            x={px(i)}
            y={vh - 8}
            textAnchor={anchorX(i)}
            fontSize={11}
            fill="var(--text-muted)"
          >
            {formatX(p.x)}
          </text>
        ) : null,
      )}
    </svg>
  );

  if (!fit) return svg;
  // `height` is the floor here, so the stacked layout — where nothing else bounds the card —
  // still gets a usable chart instead of a box collapsed to zero.
  return (
    <div ref={setBoxEl} style={{ flex: 1, minHeight: height, width: '100%' }}>
      {svg}
    </div>
  );
}

export interface BarBucket {
  key: string;
  label: string;
  segments: { type: string; count: number; color: string; title: string }[];
}

export function StackedBarChart({
  buckets,
  height = 220,
  ariaLabel,
}: {
  buckets: BarBucket[];
  height?: number;
  ariaLabel: string;
}) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const totals = buckets.map((b) => b.segments.reduce((a, s) => a + s.count, 0));
  const maxY = Math.max(4, ...totals); // floor of 4 keeps single incidents from filling the chart
  const slot = innerW / Math.max(1, buckets.length);
  const barW = Math.min(28, slot * 0.55);
  const py = (v: number) => PAD.top + innerH - (v / maxY) * innerH;

  const gridStep = maxY <= 6 ? 1 : Math.ceil(maxY / 5);
  const gridVals: number[] = [];
  for (let v = 0; v <= maxY; v += gridStep) gridVals.push(v);
  const labelStep = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label={ariaLabel}
    >
      {gridVals.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={py(v)}
            y2={py(v)}
            stroke="var(--line, #ECE0CF)"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={py(v) + 4}
            textAnchor="end"
            fontSize={11}
            fill="var(--text-muted)"
          >
            {v}
          </text>
        </g>
      ))}
      {buckets.map((b, i) => {
        const x = PAD.left + i * slot + (slot - barW) / 2;
        let acc = 0;
        return (
          <g key={b.key}>
            {b.segments
              .filter((s) => s.count > 0)
              .map((s) => {
                const y0 = py(acc + s.count);
                const h = py(acc) - py(acc + s.count);
                acc += s.count;
                return (
                  <rect key={s.type} x={x} y={y0} width={barW} height={h} rx={3} fill={s.color}>
                    <title>{`${b.label}: ${s.title} ×${s.count}`}</title>
                  </rect>
                );
              })}
            {i % labelStep === 0 && (
              <text
                x={x + barW / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-muted)"
              >
                {b.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
