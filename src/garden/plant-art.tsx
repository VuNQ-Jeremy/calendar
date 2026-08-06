import React from 'react';
import { colorOf } from '../lib/core';

/**
 * Vocabulary-garden artwork (cây từ vựng).
 *
 * One drawing, six stages. `PlantSvg` is a single composable component that toggles parts on
 * and off — there is deliberately no per-stage SVG, because the pot, soil and stem have to be
 * pixel-identical from one stage to the next or the growth animation looks like a cut, not a
 * growth spurt:
 *
 *   0  chưa trồng   pot + flat soil + a dashed hint of where the plant will go
 *      dead=true   chết queo — a snapped drooping stalk, one fallen leaf, palette greyed. Wins
 *                  over `stage`: death is a state, not a rung on the ladder.
 *   1  hạt mầm      soil mounds up, a seed peeks out of it
 *   2  nảy mầm      short stem, two round cotyledons
 *   3  cây non      taller stem, four leaves
 *   4  nở hoa       + one large purple flower and a bud on the opposite side
 *   5  ra quả       + two round orange fruits hanging from side branches
 *
 * The `wilted` variant reuses exactly those parts: the stem group tilts, leaves/flower/fruit
 * rotate down, and the root <svg> gets `garden-wilted` so CSS desaturates the whole thing (see
 * the garden section of styles/app.css — that filter survives prefers-reduced-motion because it
 * carries state, not decoration).
 *
 * Every colour is a literal hex, never a `var(--cat-*)`. The garden is rasterized to PNG by
 * html-to-image for sharing (same constraint as the fee slips — see tuition/slip-themes.tsx),
 * and custom properties resolve to nothing in the detached clone it draws from. The palette
 * entries in lib/core expose `soft`/`ink` as CSS variables for four of six colours, so we
 * rebuild the same relationship from the entry's `hex` with `softOf`/`inkOf` below.
 */

/* ── colour plumbing ───────────────────────────────────────────────────────────────────── */

const HEX_RE = /^#([0-9a-f]{6})$/i;

function toRgb(hex: string): [number, number, number] {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** Warm near-black — the direction every `ink` in the design system leans. */
const DEEP = '#2E2419';
const WHITE = '#FFFFFF';
const ASH = '#8C857D';

const softOf = (hex: string) => mix(hex, WHITE, 0.72);
const inkOf = (hex: string) => mix(hex, DEEP, 0.42);

const GREEN = colorOf('green').hex;
const VIOLET = colorOf('violet').hex;
const ORANGE = colorOf('orange').hex;
// cocoa/rose are the two entries that already carry literal hexes, so the soil needs no mixing.
const SOIL = colorOf('cocoa').base; // #A9744F
const SOIL_INK = colorOf('cocoa').ink; // #6E472C
const SEED = '#E3C08C';
const YELLOW = '#F5C24B';

interface PlantPalette {
  stem: string;
  leaf: string;
  leafInk: string;
  petal: string;
  petalInk: string;
  eye: string;
  eyeInk: string;
  fruit: string;
  fruitInk: string;
  seed: string;
  soil: string;
  soilInk: string;
  gloss: number;
}

const LIVE: PlantPalette = {
  stem: inkOf(GREEN),
  leaf: GREEN,
  leafInk: inkOf(GREEN),
  petal: VIOLET,
  petalInk: inkOf(VIOLET),
  eye: YELLOW,
  eyeInk: inkOf(YELLOW),
  fruit: ORANGE,
  fruitInk: inkOf(ORANGE),
  seed: SEED,
  soil: SOIL,
  soilInk: SOIL_INK,
  gloss: 0.7,
};

// Dead is grey-brown rather than plain grey: a colourless plant next to a coloured pot looks
// like a rendering bug, a brown one looks like something that died.
const GONE = '#A79C90';
const GONE_INK = '#6B6259';
const DEAD: PlantPalette = {
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
  soil: '#7F7566',
  soilInk: '#524A40',
  gloss: 0,
};

/** Pot fill/rim. `soft`/`ink` on the palette entry are CSS variables, so rebuild them in hex. */
function potColors(id: string | undefined, dead: boolean) {
  // Dead keeps the pot's hue — the student should still recognise their own pot — but drains it.
  const tint = dead ? mix(colorOf(id).hex, ASH, 0.7) : colorOf(id).hex;
  return { fill: softOf(tint), line: inkOf(tint) };
}

/* ── geometry ──────────────────────────────────────────────────────────────────────────── */

/**
 * Everything is laid out on a 96×96 box: the pot rim spans y 56–66, the plant's root is at
 * (48, 57), and the pot foot is at y=89. Left and right are never exact mirrors — that
 * asymmetry is the whole hand-drawn look.
 */
const STEM: Record<number, string> = {
  2: 'M48 57 C46.4 52 49.2 47 48.6 42.4',
  3: 'M48 57 C46 47.5 50.2 37 48.6 28.5',
  // Stage 4/5 leans left so the flower and the bud can sit on opposite sides of the stem.
  4: 'M48 57 C50 47 46.5 36 42.5 27',
};

interface LeafSpec {
  x: number;
  y: number;
  dir: 1 | -1;
  round?: boolean;
}

const LEAVES: Record<number, LeafSpec[]> = {
  2: [
    { x: 46.5, y: 42, dir: -1, round: true },
    { x: 49.6, y: 43, dir: 1, round: true },
  ],
  3: [
    { x: 47, y: 50, dir: -1 },
    { x: 48.4, y: 44, dir: 1 },
    { x: 49.6, y: 37, dir: -1 },
    { x: 49, y: 31, dir: 1 },
  ],
  4: [
    { x: 47, y: 51, dir: -1 },
    { x: 48.6, y: 45, dir: 1 },
    { x: 48.6, y: 38, dir: -1 },
    { x: 50, y: 32, dir: 1 },
  ],
};

/**
 * Two fruits, not three: at 96px a third one just muddies the silhouette. They hang wide and
 * high enough to clear both the pot rim and the leaf mass — a fruit half-hidden behind a leaf
 * is the difference between "ra quả" reading as a reward and reading as a smudge.
 */
const FRUITS = [
  { cx: 27.5, cy: 42, r: 7, stalk: 'M47 47 C41 42 33 37.5 28 35.5' },
  { cx: 67, cy: 44, r: 6.5, stalk: 'M48.6 43 C55 38.5 62.5 36.5 67 37.8' },
];

const FLOWER_AT = { cx: 41, cy: 19 };
const STEM_TIP_4 = { x: 42.5, y: 27 };

/* ── parts ─────────────────────────────────────────────────────────────────────────────── */

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
}: LeafSpec & { angle: number; scale?: number; fill: string; line: string }) {
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

/** Five rounded petals around a yellow eye. The purple is the point — it is what "nở hoa" means. */
function Flower({ cx, cy, p }: { cx: number; cy: number; p: PlantPalette }) {
  return (
    <g>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse
          key={a}
          cx={cx}
          cy={cy - 7.2}
          rx={5.4}
          ry={7.4}
          fill={p.petal}
          stroke={p.petalInk}
          strokeWidth={3.2}
          transform={`rotate(${a} ${cx} ${cy})`}
        />
      ))}
      <circle cx={cx} cy={cy} r={4.6} fill={p.eye} stroke={p.eyeInk} strokeWidth={3} />
    </g>
  );
}

/** The bud promises stage 5 — it is why stage 4 does not read as "finished". */
function Bud({ p }: { p: PlantPalette }) {
  return (
    <g>
      <path d="M47.5 39.5 C52.5 37 58.5 33.5 61.5 29" stroke={p.stem} strokeWidth={3.6} />
      <ellipse
        cx={62.5}
        cy={25}
        rx={4.4}
        ry={5.8}
        fill={p.petal}
        stroke={p.petalInk}
        strokeWidth={3}
        transform="rotate(16 62.5 25)"
      />
      <path d="M60.2 30 C58.4 28.8 57.8 27 58 25.6" stroke={p.stem} strokeWidth={2.6} />
      <path d="M64.6 30.2 C66.6 29.2 67.4 27.4 67.2 26" stroke={p.stem} strokeWidth={2.6} />
    </g>
  );
}

function Fruit({
  cx,
  cy,
  r,
  stalk,
  p,
}: {
  cx: number;
  cy: number;
  r: number;
  stalk: string;
  p: PlantPalette;
}) {
  return (
    <g>
      <path d={stalk} stroke={p.stem} strokeWidth={3.4} />
      <circle cx={cx} cy={cy} r={r} fill={p.fruit} stroke={p.fruitInk} strokeWidth={3.2} />
      {p.gloss > 0 && (
        <path
          d={`M${cx - r * 0.55} ${cy - r * 0.3} C${cx - r * 0.5} ${cy - r * 0.75} ${cx - r * 0.1} ${cy - r * 0.9} ${cx + r * 0.2} ${cy - r * 0.8}`}
          stroke={WHITE}
          strokeWidth={2.2}
          opacity={p.gloss * 0.75}
        />
      )}
    </g>
  );
}

/* ── the plant ─────────────────────────────────────────────────────────────────────────── */

export function PlantSvg({
  stage,
  wilted = false,
  dead = false,
  potColor = 'cocoa',
  size = 96,
  animateStageUp = false,
  className = '',
}: {
  stage: 0 | 1 | 2 | 3 | 4 | 5;
  wilted?: boolean;
  dead?: boolean;
  /** Palette id — violet | green | blue | orange | cocoa | rose. */
  potColor?: string;
  size?: number;
  animateStageUp?: boolean;
  className?: string;
}): React.ReactElement {
  const p = dead ? DEAD : LIVE;
  const pot = potColors(potColor, dead);
  // Death is not a stage, it is a state: whatever the student had grown, a dead plant is a dead
  // plant, so the dead drawing wins over `stage` instead of only pairing with stage 0.
  const droop = wilted && !dead;
  const leafAngle = (round?: boolean) => (droop ? 40 : round ? -8 : -20);
  const stemKey = stage >= 4 ? 4 : stage;

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
      <Soil fill={p.soil} />
      {(dead || stage >= 1) && <Mound fill={p.soil} line={p.soilInk} />}

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
          {stage === 1 && (
            <g transform="rotate(-14 48 51)">
              <ellipse
                cx={48}
                cy={51}
                rx={5.8}
                ry={6.8}
                fill={p.seed}
                stroke={p.soilInk}
                strokeWidth={3.2}
              />
              <path
                d="M48 46.2 C46.5 48.4 46.5 52.4 47.8 55"
                stroke={p.soilInk}
                strokeWidth={2}
                opacity={0.6}
              />
            </g>
          )}

          {stage >= 2 && <path d={STEM[stemKey]} stroke={p.stem} strokeWidth={4.2} />}

          {(LEAVES[stemKey] ?? []).map((l) => (
            <Leaf
              key={`${l.x}-${l.y}`}
              {...l}
              angle={leafAngle(l.round)}
              fill={p.leaf}
              line={p.leafInk}
            />
          ))}

          {/* Fruit before flower: the flower is the focal point and belongs on top. */}
          {stage >= 5 && (
            <g transform={droop ? 'translate(1 3)' : undefined}>
              {FRUITS.map((f) => (
                <Fruit key={f.cx} {...f} p={p} />
              ))}
            </g>
          )}

          {stage >= 4 && (
            <>
              <g transform={droop ? `rotate(24 ${STEM_TIP_4.x} ${STEM_TIP_4.y})` : undefined}>
                <Flower cx={FLOWER_AT.cx} cy={FLOWER_AT.cy} p={p} />
              </g>
              <g transform={droop ? 'rotate(14 47.5 39.5)' : undefined}>
                <Bud p={p} />
              </g>
            </>
          )}
        </g>
      )}

      {/* Only once something is in the ground — over flat soil the lip would just look like a
          second, taller mound. */}
      {(dead || stage >= 1) && <SoilLip fill={p.soil} />}
    </svg>
  );
}

/* ── the class tree ────────────────────────────────────────────────────────────────────── */

/**
 * Canopy clusters in fill order: centre first, then outward. Level is the whole class's shared
 * progress, so the tree is deliberately plainer than a personal plant — no flower, no fruit,
 * nothing a student could mistake for their own.
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
