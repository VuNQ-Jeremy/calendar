import { View } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '~/theme';
import { Muted } from '~/ui';

/**
 * The assessment charts, ported from `src/components/charts.tsx`.
 *
 * The path maths is byte-for-byte the web's: the same 900-unit viewBox, the same padding, the
 * same ordinal x-spacing, the same `maxY` floor of 4. Only the element names change
 * (`<svg>`→`<Svg>`, `<text>`→`<SvgText>`), because `react-native-svg` implements the same SVG
 * model the web renderer does.
 *
 * Two deliberate differences:
 *
 *   - Colours are theme tokens, not `var(--…)`. React Native has no CSS custom properties, and
 *     the SVG attribute would render literally.
 *   - `<title>` tooltips are dropped. They are a hover affordance and a phone has no hover; the
 *     value labels above each point carry the same information without one.
 */

const W = 900;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

export interface ChartPoint {
  /** ISO date. */
  x: string;
  y: number;
  /** e.g. the assessment type. Unused on mobile (no tooltip) but kept for parity of the data. */
  label?: string;
}

export function ProgressLineChart({
  points,
  yMin = 0,
  yMax = 10,
  height = 220,
  color,
  colorFor,
  formatX,
  emptyLabel,
}: {
  points: ChartPoint[];
  yMin?: number;
  yMax?: number;
  height?: number;
  color?: string;
  /** Per-value colour (e.g. the score bands). Applies to the dots and to each line segment. */
  colorFor?: (y: number) => string;
  formatX: (iso: string) => string;
  emptyLabel?: string;
}) {
  const th = useTheme();
  const stroke = color ?? th.color.brand;

  if (!points.length) {
    return (
      <View style={{ paddingVertical: th.spacing[8], alignItems: 'center' }}>
        <Muted>{emptyLabel}</Muted>
      </View>
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
  // A segment takes the colour of the point it arrives at — same rule as the web.
  const dotColor = (i: number) => (colorFor ? colorFor(points[i].y) : stroke);

  return (
    <Svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} accessibilityRole="image">
      {gridVals.map((v) => (
        <G key={v}>
          <Line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={py(v)}
            y2={py(v)}
            stroke={th.color.borderSubtle}
            strokeWidth={1}
          />
          <SvgText
            x={PAD.left - 8}
            y={py(v) + 4}
            textAnchor="end"
            fontSize={11}
            fill={th.color.textMuted}
          >
            {String(v)}
          </SvgText>
        </G>
      ))}

      {points.length > 1 ? <Polygon points={area} fill={stroke} opacity={0.08} /> : null}
      {points.length > 1 && colorFor
        ? points
            .slice(1)
            .map((p, i) => (
              <Line
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
        : null}
      {points.length > 1 && !colorFor ? (
        <Polyline
          points={line}
          fill="none"
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}

      {points.map((p, i) => (
        <Circle
          key={`p${i}`}
          cx={px(i)}
          cy={py(p.y)}
          r={4.5}
          fill={dotColor(i)}
          stroke={th.color.surfaceCard}
          strokeWidth={1.5}
        />
      ))}
      {points.map((p, i) => (
        <SvgText
          key={`v${i}`}
          x={px(i)}
          y={py(p.y) - 10}
          textAnchor="middle"
          fontSize={11}
          fontWeight="600"
          fill={th.color.textStrong}
        >
          {String(p.y)}
        </SvgText>
      ))}
      {points.map((p, i) =>
        showX(i) ? (
          <SvgText
            key={`x${i}`}
            x={px(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize={11}
            fill={th.color.textMuted}
          >
            {formatX(p.x)}
          </SvgText>
        ) : null,
      )}
    </Svg>
  );
}

export interface BarBucket {
  key: string;
  label: string;
  segments: { type: string; count: number; color: string }[];
}

export function StackedBarChart({
  buckets,
  height = 220,
}: {
  buckets: BarBucket[];
  height?: number;
}) {
  const th = useTheme();

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
    <Svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} accessibilityRole="image">
      {gridVals.map((v) => (
        <G key={v}>
          <Line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={py(v)}
            y2={py(v)}
            stroke={th.color.borderSubtle}
            strokeWidth={1}
          />
          <SvgText
            x={PAD.left - 8}
            y={py(v) + 4}
            textAnchor="end"
            fontSize={11}
            fill={th.color.textMuted}
          >
            {String(v)}
          </SvgText>
        </G>
      ))}

      {buckets.map((b, i) => {
        const x = PAD.left + i * slot + (slot - barW) / 2;
        let acc = 0;
        return (
          <G key={b.key}>
            {b.segments
              .filter((s) => s.count > 0)
              .map((s) => {
                const y0 = py(acc + s.count);
                const h = py(acc) - py(acc + s.count);
                acc += s.count;
                return (
                  <Rect key={s.type} x={x} y={y0} width={barW} height={h} rx={3} fill={s.color} />
                );
              })}
            {i % labelStep === 0 ? (
              <SvgText
                x={x + barW / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill={th.color.textMuted}
              >
                {b.label}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}
