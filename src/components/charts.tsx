import React from 'react';

const W = 600; // viewBox width; SVG scales to container
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
  height = 220,
  color = 'var(--brand)',
  formatX,
  ariaLabel,
  emptyLabel,
}: {
  points: ChartPoint[];
  yMin?: number;
  yMax?: number;
  height?: number;
  color?: string;
  formatX: (iso: string) => string;
  ariaLabel: string;
  emptyLabel?: string;
}) {
  if (!points.length) {
    return (
      <div className="m-muted" style={{ padding: '32px 0', textAlign: 'center' }}>
        {emptyLabel}
      </div>
    );
  }
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  // Even index spacing (ordinal x): test dates are irregular; equal spacing reads better.
  const px = (i: number) =>
    PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const py = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const gridVals: number[] = [];
  for (let v = yMin; v <= yMax; v += 2) gridVals.push(v);
  const line = points.map((p, i) => `${px(i)},${py(p.y)}`).join(' ');
  const area = `${px(0)},${py(yMin)} ${line} ${px(points.length - 1)},${py(yMin)}`;
  // At most ~6 x labels: always first and last.
  const step = Math.max(1, Math.ceil(points.length / 6));
  const showX = (i: number) => i === 0 || i === points.length - 1 || i % step === 0;

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
      {points.length > 1 && <polygon points={area} fill={color} opacity={0.08} />}
      {points.length > 1 && (
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={px(i)}
          cy={py(p.y)}
          r={4.5}
          fill={color}
          stroke="#fff"
          strokeWidth={1.5}
        >
          <title>{`${formatX(p.x)} — ${p.y}${p.label ? ` (${p.label})` : ''}`}</title>
        </circle>
      ))}
      {points.map((p, i) =>
        showX(i) ? (
          <text
            key={`x${i}`}
            x={px(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-muted)"
          >
            {formatX(p.x)}
          </text>
        ) : null,
      )}
    </svg>
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
