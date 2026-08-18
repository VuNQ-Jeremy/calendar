import React from 'react';
import { colorOf } from '../lib/core';
import {
  LOCKED_PALETTE,
  inkOf,
  mix,
  softOf,
  speciesOf,
  type PartSpec,
  type SpeciesPalette,
} from '../../shared/garden-art';

/**
 * Vocabulary-garden artwork (cây từ vựng) — the web renderer.
 *
 * The plant itself is DATA: `shared/garden-art.ts` holds every species' parts, per stage, and
 * this file turns those parts into SVG. Read that module for what the stages mean and for the
 * rules a new species has to follow. `mobile/components/garden/PlantArt.tsx` renders the very
 * same data with react-native-svg, which is what stops the two clients from drifting into two
 * different gardens.
 *
 * What stays here, deliberately, is everything that is NOT the plant:
 *
 *   0  chưa trồng   pot + flat soil + a dashed hint of where the plant will go
 *      dead=true    chết queo — a snapped drooping stalk, one fallen leaf, palette greyed. Wins
 *                   over `stage` AND over the species: death is a state, not a rung on the
 *                   ladder, and every plant dies the same way.
 *   1..5            the species' own drawing, from the registry
 *
 * The `wilted` variant tilts the whole plant and lets each part apply its own `droop`; the root
 * <svg> also gets `garden-wilted` so CSS desaturates it (see the garden section of
 * styles/app.css — that filter survives prefers-reduced-motion because it carries state, not
 * decoration).
 *
 * Every colour is a literal hex, never a `var(--cat-*)`. The garden is rasterized to PNG by
 * html-to-image for sharing (same constraint as the fee slips — see tuition/slip-themes.tsx),
 * and custom properties resolve to nothing in the detached clone it draws from.
 */

/* ── colour plumbing ───────────────────────────────────────────────────────────────────── */

const WHITE = '#FFFFFF';
const ASH = '#8C857D';

const SOIL = colorOf('cocoa').base; // #A9744F
const SOIL_INK = colorOf('cocoa').ink; // #6E472C

// Dead is grey-brown rather than plain grey: a colourless plant next to a coloured pot looks
// like a rendering bug, a brown one looks like something that died.
const GONE = '#A79C90';
const GONE_INK = '#6B6259';
const DEAD: SpeciesPalette = {
  stem: GONE_INK,
  leaf: GONE,
  leafInk: GONE_INK,
  petal: GONE,
  petalInk: GONE_INK,
  eye: GONE,
  eyeInk: GONE_INK,
  fruit: GONE,
  fruitInk: GONE_INK,
  seed: GONE,
  // Kept a couple of steps darker than the withered plant, or the grey leaves disappear into
  // the grey soil and the whole pot reads as one lump.
  soilInk: '#524A40',
  white: WHITE,
  gloss: 0,
};
/** The soil is chrome, so its two hexes live here rather than on any species' palette. */
const DEAD_SOIL = '#7F7566';

/** Pot fill/rim. `soft`/`ink` on the palette entry are CSS variables, so rebuild them in hex. */
function potColors(id: string | undefined, dead: boolean) {
  // Dead keeps the pot's hue — the student should still recognise their own pot — but drains it.
  const tint = dead ? mix(colorOf(id).hex, ASH, 0.7) : colorOf(id).hex;
  return { fill: softOf(tint), line: inkOf(tint) };
}

/* ── chrome ────────────────────────────────────────────────────────────────────────────── */

/**
 * Deeper than it is wide across the rim, or it reads as a casserole dish rather than a plant pot.
 */
function Pot({ fill, line }: { fill: string; line: string }) {
  return (
    <>
      <path
        d="M27.5 65.5 L32.5 85 Q33.5 89 38 89 L58 89 Q62.5 89 63.5 85 L68.5 65.5 Z"
        fill={fill}
        stroke={line}
      />
      {/* rim, drawn over the body so the join needs no clipping */}
      <rect x="24" y="56" width="48" height="10" rx="5" fill={fill} stroke={line} />
    </>
  );
}

/**
 * Dirt seen through the pot's opening — a lens that stays clear of the rim's top stroke, so the
 * rim keeps its outline and the soil never reads as a lid sitting on top of the pot.
 */
function Soil({ fill }: { fill: string }) {
  return (
    <path
      d="M26.5 58.8 Q36 57.9 48 57.7 Q60 57.9 69.5 58.8 Q60 62.6 48 63 Q36 62.6 26.5 58.8 Z"
      fill={fill}
      stroke="none"
    />
  );
}

/**
 * The hill of soil that says something has been planted. Its flat bottom hides inside the rim's
 * top stroke, so the hill needs no seam and the rim still passes behind it.
 */
function Mound({ fill, line }: { fill: string; line: string }) {
  return (
    <path
      d="M33 58 Q38 52.2 48 51.4 Q58 52.2 63 58 Z"
      fill={fill}
      stroke={line}
      strokeWidth={3.6}
    />
  );
}

/**
 * A smaller unstroked copy of the mound, painted last so the stem and the seed appear to come
 * out of the soil instead of standing on it. Fill-only on purpose: a stroke here would double
 * the mound's outline.
 */
function SoilLip({ fill }: { fill: string }) {
  return <path d="M38.5 58 Q43 54.5 48 54 Q53 54.5 57.5 58 Z" fill={fill} stroke="none" />;
}

/** Four-point star, sized and placed by `at`/`s`. Only used for the empty-pot hint. */
function Sparkle({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) {
  return (
    <path
      d="M0 -6 C1 -2 2 -1 6 0 C2 1 1 2 0 6 C-1 2 -2 1 -6 0 C-2 -1 -1 -2 0 -6 Z"
      transform={`translate(${x} ${y}) scale(${s})`}
      fill={fill}
      stroke="none"
    />
  );
}

/**
 * One leaf, drawn pointing +x from its attachment point. `dir: -1` mirrors it; the mirror is
 * uniform so stroke weight is unchanged. `angle` is the only thing wilting touches.
 */
function Leaf({
  x,
  y,
  dir,
  angle,
  round,
  scale = 1,
  fill,
  line,
}: {
  x: number;
  y: number;
  dir: 1 | -1;
  angle: number;
  round?: boolean;
  scale?: number;
  fill: string;
  line: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${dir * scale} ${scale}) rotate(${angle})`}>
      <path
        d={
          round
            ? 'M0 0 C1 -8 10.5 -11 14.8 -5.4 C15.6 1 8 5.6 0 0 Z'
            : 'M0 0 C4.5 -8 14 -9.5 19 -3.2 C13 4 4.5 5 0 0 Z'
        }
        fill={fill}
        stroke={line}
        strokeWidth={3.4}
      />
      <path
        d={round ? 'M1.6 -0.6 C5.5 -2.6 9.5 -3.6 12.6 -3.4' : 'M1.5 -0.4 C7 -2.5 12 -3.6 16.6 -3.4'}
        stroke={line}
        strokeWidth={2.1}
        opacity={0.7}
      />
    </g>
  );
}

/* ── the parts renderer ────────────────────────────────────────────────────────────────── */

/** A part's colour role resolved against the palette in play (live, wilted-dead, or locked). */
const hue = (p: SpeciesPalette, role: keyof SpeciesPalette | undefined): string | undefined =>
  role === undefined ? undefined : (p[role] as string);

/**
 * One registry part → one SVG element. `droop` is the wilt: parts opt in by carrying their own
 * transform in the data, so a species author decides how their plant sags.
 */
function renderPart(part: PartSpec, p: SpeciesPalette, droop: boolean, key: string): React.ReactElement {
  switch (part.kind) {
    // `fill` is emitted only when the part asks for one: the root <svg fill="none"> already
    // covers stroke-only shapes, and spelling it out on every path would be noise. (The RN twin
    // must do the opposite — its default fill is black.)
    case 'path':
      return (
        <path
          key={key}
          d={part.d}
          fill={hue(p, part.fill)}
          stroke={hue(p, part.stroke)}
          strokeWidth={part.strokeWidth}
          opacity={part.opacity}
          strokeDasharray={part.dash}
        />
      );
    case 'circle':
      return (
        <circle
          key={key}
          cx={part.cx}
          cy={part.cy}
          r={part.r}
          fill={hue(p, part.fill)}
          stroke={hue(p, part.stroke)}
          strokeWidth={part.strokeWidth}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          key={key}
          cx={part.cx}
          cy={part.cy}
          rx={part.rx}
          ry={part.ry}
          fill={hue(p, part.fill)}
          stroke={hue(p, part.stroke)}
          strokeWidth={part.strokeWidth}
          transform={
            part.rotate ? `rotate(${part.rotate.deg} ${part.rotate.cx} ${part.rotate.cy})` : undefined
          }
        />
      );
    case 'leaf':
      return (
        <Leaf
          key={key}
          x={part.x}
          y={part.y}
          dir={part.dir}
          scale={part.scale}
          round={part.shape === 'round'}
          angle={droop ? part.droopAngle : part.baseAngle}
          fill={p.leaf}
          line={p.leafInk}
        />
      );
    case 'petalRing': {
      const step = 360 / part.count;
      return (
        <g key={key}>
          {Array.from({ length: part.count }, (_, i) => (
            <ellipse
              key={i}
              cx={part.cx}
              cy={part.cy - part.dy}
              rx={part.rx}
              ry={part.ry}
              fill={p.petal}
              stroke={p.petalInk}
              strokeWidth={part.petalStrokeWidth ?? 3.2}
              transform={`rotate(${i * step} ${part.cx} ${part.cy})`}
            />
          ))}
        </g>
      );
    }
    case 'fruit': {
      const { cx, cy, r } = part;
      return (
        <g key={key}>
          <path d={part.stalk} stroke={p.stem} strokeWidth={3.4} />
          <circle cx={cx} cy={cy} r={r} fill={p.fruit} stroke={p.fruitInk} strokeWidth={3.2} />
          {p.gloss > 0 && (
            <path
              d={`M${cx - r * 0.55} ${cy - r * 0.3} C${cx - r * 0.5} ${cy - r * 0.75} ${cx - r * 0.1} ${cy - r * 0.9} ${cx + r * 0.2} ${cy - r * 0.8}`}
              stroke={p.white}
              strokeWidth={2.2}
              opacity={p.gloss * 0.75}
            />
          )}
        </g>
      );
    }
    case 'group': {
      const d = part.droop;
      const wilt = !droop || !d ? '' : 'rotate' in d ? `rotate(${d.rotate} ${d.cx} ${d.cy})` : `translate(${d.translate[0]} ${d.translate[1]})`;
      const transform = [wilt, part.transform].filter(Boolean).join(' ') || undefined;
      return (
        <g key={key} transform={transform}>
          {part.parts.map((child, i) => renderPart(child, p, droop, `${key}.${i}`))}
        </g>
      );
    }
  }
}

/* ── the plant ─────────────────────────────────────────────────────────────────────────── */

export function PlantSvg({
  stage,
  wilted = false,
  dead = false,
  potColor = 'cocoa',
  species = 'classic',
  locked = false,
  size = 96,
  animateStageUp = false,
  className = '',
}: {
  stage: 0 | 1 | 2 | 3 | 4 | 5;
  wilted?: boolean;
  dead?: boolean;
  /** Palette id — violet | green | blue | orange | cocoa | rose. */
  potColor?: string;
  /** Species id from shared/garden-art.ts. An unknown id draws the classic plant. */
  species?: string;
  /** Draw as a grey silhouette — the picker's preview of a species not yet earned. */
  locked?: boolean;
  size?: number;
  animateStageUp?: boolean;
  className?: string;
}): React.ReactElement {
  const art = speciesOf(species);
  const p = dead ? DEAD : locked ? LOCKED_PALETTE : art.palette;
  const pot = potColors(potColor, dead);
  const soil = dead ? DEAD_SOIL : SOIL;
  // Death is not a stage, it is a state: whatever the student had grown, a dead plant is a dead
  // plant, so the dead drawing wins over `stage` instead of only pairing with stage 0.
  const droop = wilted && !dead;

  const cls = [
    'garden-plant',
    // Wilted and dead both desaturate; `.garden-wilted` is declared after `.garden-pop` in
    // app.css, so a wilted plant that gains a stage settles instead of popping. Fine: the
    // droop is the more important message.
    wilted || dead ? 'garden-wilted' : '',
    animateStageUp ? 'garden-pop' : '',
    // Sway is only worth it once there is foliage to move, and never over a one-shot pop.
    !wilted && !dead && !animateStageUp && stage >= 2 ? 'garden-sway' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const parts = stage >= 1 && stage <= 5 ? art.stages[stage as 1 | 2 | 3 | 4 | 5] : [];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke="none"
      strokeWidth={4.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cls}
      aria-hidden="true"
    >
      <Pot fill={pot.fill} line={pot.line} />
      <Soil fill={soil} />
      {(dead || stage >= 1) && <Mound fill={soil} line={p.soilInk} />}

      {stage === 0 && !dead && (
        // Nothing planted: a dashed arch where the plant will be, plus sparkles, so the empty
        // pot reads as an invitation rather than as a failure.
        <g opacity={0.42}>
          <path
            d="M39 53 C36.5 42 43 34.5 48 34.5 C53 34.5 59.5 42 57 53"
            stroke={p.soilInk}
            strokeWidth={2.8}
            strokeDasharray="3.5 5.5"
          />
          <Sparkle x={48} y={26} s={1.15} fill={p.soilInk} />
          <Sparkle x={60.5} y={35} s={0.6} fill={p.soilInk} />
          <Sparkle x={36} y={38} s={0.45} fill={p.soilInk} />
        </g>
      )}

      {dead ? (
        // One bare stalk, leaning and snapped, with the broken piece hanging on the same side as
        // the lean. Both pieces have to stay on one side: an arc that comes back down towards the
        // pot closes the silhouette and the whole thing turns into a basket with a handle.
        // Species-agnostic on purpose — every plant dies the same way.
        <g>
          <path d="M48 57 C47.5 47 45.5 38 41.5 32.5" stroke={p.stem} strokeWidth={4.2} />
          <path d="M38.2 31.6 C34.2 34.4 33.4 39.6 35.4 44.6" stroke={p.stem} strokeWidth={3.4} />
          {/* frayed hairs at the break — the cartoon shorthand for "snapped" */}
          <path d="M41 30.6 L43.2 28.4" stroke={p.stem} strokeWidth={1.9} opacity={0.75} />
          <path d="M37.6 34 L35 32.8" stroke={p.stem} strokeWidth={1.9} opacity={0.75} />
          {/* one leaf still attached, hanging straight down */}
          <Leaf x={46.8} y={38} dir={-1} angle={74} scale={0.68} fill={p.leaf} line={p.leafInk} />
          {/* and one lying where it fell — the detail that sells "chết queo" */}
          <Leaf x={56} y={52.6} dir={1} angle={32} scale={0.62} fill={p.leaf} line={p.leafInk} />
        </g>
      ) : (
        <g transform={droop ? 'rotate(7 48 57)' : undefined}>
          {parts.map((part, i) => renderPart(part, p, droop, String(i)))}
        </g>
      )}

      {/* Only once something is in the ground — over flat soil the lip would just look like a
          second, taller mound. */}
      {(dead || stage >= 1) && <SoilLip fill={soil} />}
    </svg>
  );
}

/* ── the class tree ────────────────────────────────────────────────────────────────────── */

/**
 * Canopy clusters in fill order: centre first, then outward. Level is the whole class's shared
 * progress, so the tree is deliberately plainer than a personal plant — no flower, no fruit,
 * nothing a student could mistake for their own. It has no species, for the same reason.
 */
const CANOPY = [
  { cx: 48, cy: 31, r: 14 },
  { cx: 32, cy: 38, r: 12 },
  { cx: 64, cy: 38, r: 12 },
  { cx: 40, cy: 22, r: 10 },
  { cx: 57, cy: 21, r: 10 },
  { cx: 48, cy: 45, r: 11 },
  { cx: 23, cy: 48, r: 9.5 },
  { cx: 73, cy: 48, r: 9.5 },
];

const BLOSSOMS = [
  { cx: 34, cy: 27 },
  { cx: 61, cy: 30 },
  { cx: 48, cy: 16 },
  { cx: 25, cy: 42 },
  { cx: 71, cy: 43 },
];

const YELLOW = '#F5C24B';

export function ClassTreeSvg({
  level,
  size = 128,
  className = '',
}: {
  level: number;
  size?: number;
  className?: string;
}): React.ReactElement {
  const lv = Math.max(0, Math.min(10, Math.round(level || 0)));
  const clusters = lv === 0 ? 0 : Math.max(1, Math.round((lv / 10) * CANOPY.length));
  const blooms = lv >= 6 ? Math.min(BLOSSOMS.length, lv - 5) : 0;
  const leaf = colorOf('green').hex;
  const leafInk = inkOf(leaf);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['garden-tree', className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <path d="M20 85 Q48 89.5 76 85" stroke={SOIL} strokeWidth={4.2} opacity={0.9} />
      <path d="M48.5 86 C47.6 76 48 66 48 54" stroke={SOIL_INK} strokeWidth={6.5} />
      <path d="M48 63 C43.5 59 38.5 55 33.5 52.5" stroke={SOIL_INK} strokeWidth={4.6} />
      <path d="M48 58 C53 54.5 58.5 50.5 63.5 48.5" stroke={SOIL_INK} strokeWidth={4.6} />
      <path d="M48 54 C47 49 47.6 44 48 40" stroke={SOIL_INK} strokeWidth={4.6} />

      {/* Outlines first, fills on top: each stroke survives only where it sticks out past its
          neighbours, so the clusters read as one canopy with a clean silhouette instead of a
          pile of circles with lines through it. */}
      {CANOPY.slice(0, clusters).map((c) => (
        <circle
          key={`s${c.cx}-${c.cy}`}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          stroke={leafInk}
          strokeWidth={3.6}
        />
      ))}
      {CANOPY.slice(0, clusters).map((c) => (
        <circle key={`f${c.cx}-${c.cy}`} cx={c.cx} cy={c.cy} r={c.r} fill={leaf} />
      ))}

      {BLOSSOMS.slice(0, blooms).map((b) => (
        <circle
          key={`b${b.cx}`}
          cx={b.cx}
          cy={b.cy}
          r={3.4}
          fill={YELLOW}
          stroke={inkOf(YELLOW)}
          strokeWidth={2.4}
        />
      ))}
    </svg>
  );
}

/** i18n key suffix for the stage label, e.g. 'garden_stage_2'. */
export function stageKey(stage: number, dead?: boolean): string {
  if (dead) return 'garden_stage_dead';
  return `garden_stage_${Math.max(0, Math.min(5, Math.round(stage || 0)))}`;
}
