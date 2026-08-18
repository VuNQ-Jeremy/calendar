import { categoryColor } from './tokens';

/**
 * Vườn cây từ vựng — what each plant species looks like, as data.
 *
 * The garden used to have exactly one drawing, written twice: once in `src/garden/plant-art.tsx`
 * as DOM SVG and once in `mobile/components/garden/PlantArt.tsx` as react-native-svg, kept in
 * sync by hand. That is affordable for one plant and ruinous for ten, so the geometry moved here
 * and both files became thin renderers over it — the same relationship `shared/logic/garden.ts`
 * already has with the lifecycle rules.
 *
 * What lives here: the plant itself, per stage, per species. What deliberately does NOT:
 *
 *   - the pot, the soil, the mound and the empty-pot hint — chrome every species shares;
 *   - the dead drawing — one snapped grey stalk for every species, because death is a state
 *     rather than a species trait (and it halves the art budget);
 *   - the wilt's *colour* — the web desaturates with a CSS filter, mobile bakes a greyer palette,
 *     and neither belongs in shared data. The wilt's *geometry* does live here, as `droop`.
 *
 * ## Unlocks
 *
 * A species is unlocked by lifetime harvested fruit (`fruitsTotal` on the plant row), derived at
 * read time — there is no unlock table and nothing to keep in sync. `classic` is at zero, which
 * is what makes the "no plant row yet" case free: a student who has never played provably has no
 * fruit, so `classic` is all they could pick, and the column default already says `classic`.
 * **Adding a second species at threshold 0 would break that reasoning** — see the guard in
 * `updatePlant` (server/services/garden.ts) and the test that pins it.
 *
 * ## Authoring a species
 *
 * Everything is laid out on the same 96×96 box the original used: the pot rim spans y 56–66, the
 * plant's root is at (48, 57). Rules learned from the first drawing, all still binding:
 *
 *   - Left and right are never exact mirrors. The asymmetry is the whole hand-drawn look.
 *   - Each stage must strictly ADD to the last. Growth that re-draws reads as a cut.
 *   - Anchors are hand-placed, not derived. There is no "attach at the stem tip" — the stage-4
 *     stem leans a particular way so that a flower and a bud can sit on opposite sides of it, and
 *     the flower's droop pivot is that stem's tip, hand-copied. Expect to eyeball every species.
 *   - Colours are literal hex, never CSS variables: the share card is rasterized by html-to-image
 *     from a detached clone, where custom properties resolve to nothing.
 */

/* ── colour plumbing ───────────────────────────────────────────────────────────────────── */

const HEX_RE = /^#([0-9a-f]{6})$/i;

function toRgb(hex: string): [number, number, number] {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** Warm near-black — the direction every `ink` in the design system leans. */
export const DEEP = '#2E2419';
export const WHITE = '#FFFFFF';

export const softOf = (hex: string) => mix(hex, WHITE, 0.72);
export const inkOf = (hex: string) => mix(hex, DEEP, 0.42);

const GREEN = categoryColor.green.base;
const VIOLET = categoryColor.violet.base;
const ORANGE = categoryColor.orange.base;
const SOIL_INK = categoryColor.cocoa.ink; // #6E472C
const SEED = '#E3C08C';
const YELLOW = '#F5C24B';

/* ── the shape of a species ────────────────────────────────────────────────────────────── */

export type ColorRole =
  | 'stem'
  | 'leaf'
  | 'leafInk'
  | 'petal'
  | 'petalInk'
  | 'eye'
  | 'eyeInk'
  | 'fruit'
  | 'fruitInk'
  | 'seed'
  | 'soilInk'
  | 'white';

export type SpeciesPalette = Record<ColorRole, string> & {
  /** 0–1 highlight strength on fruit. 0 turns the gloss stroke off entirely. */
  gloss: number;
};

/**
 * How a part moves when the plant wilts. Rotation carries its own origin so the RN renderer can
 * use `<G rotation origin>` without parsing anything; translate exists because the classic fruits
 * sag rather than swing.
 */
export type Droop = { rotate: number; cx: number; cy: number } | { translate: [number, number] };

export type PartSpec =
  | {
      kind: 'path';
      d: string;
      stroke?: ColorRole;
      strokeWidth?: number;
      fill?: ColorRole;
      opacity?: number;
      dash?: string;
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill?: ColorRole;
      stroke?: ColorRole;
      strokeWidth?: number;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill?: ColorRole;
      stroke?: ColorRole;
      strokeWidth?: number;
      rotate?: { deg: number; cx: number; cy: number };
    }
  /** The composite leaf: one blade path plus its vein, mirrored by `dir`. */
  | {
      kind: 'leaf';
      x: number;
      y: number;
      dir: 1 | -1;
      shape: 'round' | 'pointed';
      scale?: number;
      baseAngle: number;
      droopAngle: number;
    }
  /** `count` petals evenly spaced about (cx, cy), each `dy` above the centre before rotation. */
  | {
      kind: 'petalRing';
      cx: number;
      cy: number;
      count: number;
      rx: number;
      ry: number;
      dy: number;
      petalStrokeWidth?: number;
    }
  /** Stalk + body + a gloss highlight the renderer computes from `r` and `palette.gloss`. */
  | { kind: 'fruit'; cx: number; cy: number; r: number; stalk: string }
  | { kind: 'group'; parts: PartSpec[]; transform?: string; droop?: Droop };

export type PlantStageNum = 1 | 2 | 3 | 4 | 5;

export interface SpeciesArt {
  id: string;
  /** Lifetime fruit needed to unlock. `classic` is 0 and must stay the only one. */
  unlockAt: number;
  palette: SpeciesPalette;
  /** Paint order is array order. Stage 0 is the empty pot, which is chrome, so it is absent. */
  stages: Record<PlantStageNum, PartSpec[]>;
}

/** Every colour drained to one grey pair — what a species looks like before it is unlocked. */
export const LOCKED_PALETTE: SpeciesPalette = {
  stem: '#8C857D',
  leaf: '#C9C2B9',
  leafInk: '#8C857D',
  petal: '#C9C2B9',
  petalInk: '#8C857D',
  eye: '#C9C2B9',
  eyeInk: '#8C857D',
  fruit: '#C9C2B9',
  fruitInk: '#8C857D',
  seed: '#C9C2B9',
  soilInk: '#8C857D',
  white: WHITE,
  gloss: 0,
};

/* ── shared building blocks ────────────────────────────────────────────────────────────── */

/**
 * The seed, tilted in its own group. Every species starts the same way on purpose: at stage 1
 * nothing is above the soil yet, so a species-specific seed would be a promise the drawing cannot
 * keep. Only the `seed` colour differs.
 */
const SEED_PARTS: PartSpec[] = [
  {
    kind: 'group',
    transform: 'rotate(-14 48 51)',
    parts: [
      {
        kind: 'ellipse',
        cx: 48,
        cy: 51,
        rx: 5.8,
        ry: 6.8,
        fill: 'seed',
        stroke: 'soilInk',
        strokeWidth: 3.2,
      },
      {
        kind: 'path',
        d: 'M48 46.2 C46.5 48.4 46.5 52.4 47.8 55',
        stroke: 'soilInk',
        strokeWidth: 2,
        opacity: 0.6,
      },
    ],
  },
];

/* ── classic ───────────────────────────────────────────────────────────────────────────── */

/**
 * The original drawing, ported literal-for-literal from the pre-registry `plant-art.tsx`. The
 * render harness (`scripts/render-plants.mjs`) diffs its SVG against a baseline captured before
 * the port, so these numbers are load-bearing: change one and the parity gate fails.
 */
const CLASSIC_STEM_2: PartSpec = {
  kind: 'path',
  d: 'M48 57 C46.4 52 49.2 47 48.6 42.4',
  stroke: 'stem',
  strokeWidth: 4.2,
};
const CLASSIC_STEM_3: PartSpec = {
  kind: 'path',
  d: 'M48 57 C46 47.5 50.2 37 48.6 28.5',
  stroke: 'stem',
  strokeWidth: 4.2,
};
/** Leans left so the flower and the bud can sit on opposite sides of the stem. */
const CLASSIC_STEM_4: PartSpec = {
  kind: 'path',
  d: 'M48 57 C50 47 46.5 36 42.5 27',
  stroke: 'stem',
  strokeWidth: 4.2,
};

const CLASSIC_LEAVES_2: PartSpec[] = [
  { kind: 'leaf', x: 46.5, y: 42, dir: -1, shape: 'round', baseAngle: -8, droopAngle: 40 },
  { kind: 'leaf', x: 49.6, y: 43, dir: 1, shape: 'round', baseAngle: -8, droopAngle: 40 },
];

const CLASSIC_LEAVES_3: PartSpec[] = [
  { kind: 'leaf', x: 47, y: 50, dir: -1, shape: 'pointed', baseAngle: -20, droopAngle: 40 },
  { kind: 'leaf', x: 48.4, y: 44, dir: 1, shape: 'pointed', baseAngle: -20, droopAngle: 40 },
  { kind: 'leaf', x: 49.6, y: 37, dir: -1, shape: 'pointed', baseAngle: -20, droopAngle: 40 },
  { kind: 'leaf', x: 49, y: 31, dir: 1, shape: 'pointed', baseAngle: -20, droopAngle: 40 },
];

const CLASSIC_LEAVES_4: PartSpec[] = [
  { kind: 'leaf', x: 47, y: 51, dir: -1, shape: 'pointed', baseAngle: -20, droopAngle: 40 },
  { kind: 'leaf', x: 48.6, y: 45, dir: 1, shape: 'pointed', baseAngle: -20, droopAngle: 40 },
  { kind: 'leaf', x: 48.6, y: 38, dir: -1, shape: 'pointed', baseAngle: -20, droopAngle: 40 },
  { kind: 'leaf', x: 50, y: 32, dir: 1, shape: 'pointed', baseAngle: -20, droopAngle: 40 },
];

/** Five rounded petals around a yellow eye. Droops about the stem tip, not its own centre. */
const CLASSIC_FLOWER: PartSpec = {
  kind: 'group',
  droop: { rotate: 24, cx: 42.5, cy: 27 },
  parts: [
    { kind: 'petalRing', cx: 41, cy: 19, count: 5, rx: 5.4, ry: 7.4, dy: 7.2, petalStrokeWidth: 3.2 },
    { kind: 'circle', cx: 41, cy: 19, r: 4.6, fill: 'eye', stroke: 'eyeInk', strokeWidth: 3 },
  ],
};

/** The bud promises stage 5 — it is why stage 4 does not read as "finished". */
const CLASSIC_BUD: PartSpec = {
  kind: 'group',
  droop: { rotate: 14, cx: 47.5, cy: 39.5 },
  parts: [
    { kind: 'path', d: 'M47.5 39.5 C52.5 37 58.5 33.5 61.5 29', stroke: 'stem', strokeWidth: 3.6 },
    {
      kind: 'ellipse',
      cx: 62.5,
      cy: 25,
      rx: 4.4,
      ry: 5.8,
      fill: 'petal',
      stroke: 'petalInk',
      strokeWidth: 3,
      rotate: { deg: 16, cx: 62.5, cy: 25 },
    },
    { kind: 'path', d: 'M60.2 30 C58.4 28.8 57.8 27 58 25.6', stroke: 'stem', strokeWidth: 2.6 },
    { kind: 'path', d: 'M64.6 30.2 C66.6 29.2 67.4 27.4 67.2 26', stroke: 'stem', strokeWidth: 2.6 },
  ],
};

/**
 * Two fruits, not three: at 96px a third just muddies the silhouette. They hang wide and high
 * enough to clear both the pot rim and the leaf mass. They sag rather than swing when wilted.
 */
const CLASSIC_FRUITS: PartSpec = {
  kind: 'group',
  droop: { translate: [1, 3] },
  parts: [
    { kind: 'fruit', cx: 27.5, cy: 42, r: 7, stalk: 'M47 47 C41 42 33 37.5 28 35.5' },
    { kind: 'fruit', cx: 67, cy: 44, r: 6.5, stalk: 'M48.6 43 C55 38.5 62.5 36.5 67 37.8' },
  ],
};

const CLASSIC: SpeciesArt = {
  id: 'classic',
  unlockAt: 0,
  palette: {
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
    soilInk: SOIL_INK,
    white: WHITE,
    gloss: 0.7,
  },
  stages: {
    1: SEED_PARTS,
    2: [CLASSIC_STEM_2, ...CLASSIC_LEAVES_2],
    3: [CLASSIC_STEM_3, ...CLASSIC_LEAVES_3],
    4: [CLASSIC_STEM_4, ...CLASSIC_LEAVES_4, CLASSIC_FLOWER, CLASSIC_BUD],
    // Fruit before flower: the flower is the focal point and belongs on top.
    5: [CLASSIC_STEM_4, ...CLASSIC_LEAVES_4, CLASSIC_FRUITS, CLASSIC_FLOWER, CLASSIC_BUD],
  },
};

/* ── the other nine ────────────────────────────────────────────────────────────────────── */

/**
 * Placeholder art: the classic geometry wearing the species' own palette. Each is replaced by a
 * real drawing in its art commit; until then a student who unlocks one sees a recoloured classic
 * rather than an empty pot, which is the failure mode worth having.
 */
function pending(id: string, unlockAt: number, palette: SpeciesPalette): SpeciesArt {
  return { id, unlockAt, palette, stages: CLASSIC.stages };
}

const paletteOf = (over: Partial<SpeciesPalette>): SpeciesPalette => ({
  ...CLASSIC.palette,
  ...over,
});

const RED = '#E0533D';
const CHILI = '#D93A2B';
const CREAM = '#FFF3C9';
const OFF_WHITE = '#F7F3EC';
const PINK = categoryColor.rose.base;
const MANGO = '#F0A23B';
const KUMQUAT = '#F2913A';
const BLOSSOM = '#F4A6C0';

/* ── cà chua (tomato) ──────────────────────────────────────────────────────────────────────
 *
 * A bush rather than a stalk: two stems from the same root, leaning apart, so the silhouette is
 * wider than the classic's and reads as "vine" at 96px. The fruit is the whole point of a tomato,
 * so stage 5 hangs three of them — one low and large, two smaller up in the leaves.
 */
const CACHUA_MAIN: PartSpec = {
  kind: 'path',
  d: 'M48 57 C47 48 45 40 43.5 31',
  stroke: 'stem',
  strokeWidth: 4.2,
};
const CACHUA_BRANCH: PartSpec = {
  kind: 'path',
  d: 'M47 47 C51 43 55.5 39.5 58.5 34.5',
  stroke: 'stem',
  strokeWidth: 3.4,
};

const CACHUA: SpeciesArt = {
  id: 'cachua',
  unlockAt: 1,
  palette: paletteOf({
    petal: CREAM,
    petalInk: inkOf(YELLOW),
    eye: YELLOW,
    eyeInk: inkOf(YELLOW),
    fruit: RED,
    fruitInk: inkOf(RED),
    gloss: 0.8,
  }),
  stages: {
    1: SEED_PARTS,
    2: [
      { kind: 'path', d: 'M48 57 C47.2 52 46 47.5 45.6 43', stroke: 'stem', strokeWidth: 4.2 },
      { kind: 'leaf', x: 45.2, y: 43.5, dir: -1, shape: 'round', baseAngle: -14, droopAngle: 40 },
      { kind: 'leaf', x: 47.2, y: 44.5, dir: 1, shape: 'round', baseAngle: -4, droopAngle: 44 },
    ],
    3: [
      CACHUA_MAIN,
      CACHUA_BRANCH,
      { kind: 'leaf', x: 46.6, y: 49, dir: -1, shape: 'pointed', baseAngle: -18, droopAngle: 42 },
      { kind: 'leaf', x: 49, y: 45, dir: 1, shape: 'pointed', baseAngle: -12, droopAngle: 44 },
      { kind: 'leaf', x: 44.6, y: 38, dir: -1, shape: 'pointed', baseAngle: -26, droopAngle: 38 },
      { kind: 'leaf', x: 57, y: 35.5, dir: 1, shape: 'pointed', baseAngle: -22, droopAngle: 40 },
    ],
    4: [],
    5: [],
  },
};
// Stage 4 adds the little yellow star-flowers a tomato actually has; 5 turns two of them to fruit.
CACHUA.stages[4] = [
  ...CACHUA.stages[3],
  { kind: 'leaf', x: 45.6, y: 32.5, dir: 1, shape: 'pointed', baseAngle: -30, droopAngle: 36 },
  {
    kind: 'group',
    droop: { rotate: 20, cx: 43.5, cy: 31 },
    parts: [
      { kind: 'petalRing', cx: 39.5, cy: 24, count: 5, rx: 3.2, ry: 4.6, dy: 4.4, petalStrokeWidth: 2.6 },
      { kind: 'circle', cx: 39.5, cy: 24, r: 2.6, fill: 'eye', stroke: 'eyeInk', strokeWidth: 2.2 },
    ],
  },
  {
    kind: 'group',
    droop: { rotate: 16, cx: 58.5, cy: 34.5 },
    parts: [
      { kind: 'petalRing', cx: 61.5, cy: 29.5, count: 5, rx: 2.6, ry: 3.8, dy: 3.6, petalStrokeWidth: 2.4 },
      { kind: 'circle', cx: 61.5, cy: 29.5, r: 2, fill: 'eye', stroke: 'eyeInk', strokeWidth: 2 },
    ],
  },
];
CACHUA.stages[5] = [
  ...CACHUA.stages[3],
  {
    kind: 'group',
    droop: { translate: [1, 3] },
    parts: [
      { kind: 'fruit', cx: 30, cy: 44, r: 7.5, stalk: 'M46 48 C41 45 35 42 31 39' },
      { kind: 'fruit', cx: 63.5, cy: 41, r: 5.6, stalk: 'M56 37 C59 38 62 39.5 63.5 40' },
      { kind: 'fruit', cx: 43, cy: 26, r: 5, stalk: 'M44 31 C43.6 29.5 43.2 28 43 26.5' },
    ],
  },
];

/* ── hướng dương (sunflower) ───────────────────────────────────────────────────────────────
 *
 * One tall straight stalk and one enormous head — the opposite composition to the classic's
 * scattered flowers, which is what makes it recognisable at a glance. The head is a wide petal
 * ring around a brown disc; at stage 5 the disc grows seeds and the whole head bows, the way a
 * ripe sunflower actually hangs.
 */
const HUONGDUONG_PALETTE = paletteOf({
  petal: YELLOW,
  petalInk: inkOf(YELLOW),
  eye: '#7A4A26',
  eyeInk: inkOf('#7A4A26'),
  fruit: '#7A4A26',
  fruitInk: inkOf('#7A4A26'),
  gloss: 0,
});

/** The head, hand-placed at the stalk's tip. `bow` is how far it nods when wilted. */
function sunflowerHead(cx: number, cy: number, scale: number, bow: Droop): PartSpec {
  return {
    kind: 'group',
    droop: bow,
    parts: [
      // Two offset rings of petals — a single ring at this size looks like a gear.
      { kind: 'petalRing', cx, cy, count: 8, rx: 3.4 * scale, ry: 6.4 * scale, dy: 7.6 * scale, petalStrokeWidth: 2.6 },
      { kind: 'petalRing', cx, cy, count: 7, rx: 3 * scale, ry: 5.6 * scale, dy: 6.4 * scale, petalStrokeWidth: 2.4 },
      { kind: 'circle', cx, cy, r: 5.6 * scale, fill: 'eye', stroke: 'eyeInk', strokeWidth: 3 },
    ],
  };
}

const HUONGDUONG: SpeciesArt = {
  id: 'huongduong',
  unlockAt: 2,
  palette: HUONGDUONG_PALETTE,
  stages: {
    1: SEED_PARTS,
    2: [
      { kind: 'path', d: 'M48 57 C48.4 52 48 47.5 48.2 43.5', stroke: 'stem', strokeWidth: 4.2 },
      { kind: 'leaf', x: 46.8, y: 44, dir: -1, shape: 'round', baseAngle: -10, droopAngle: 42 },
      { kind: 'leaf', x: 49.4, y: 45, dir: 1, shape: 'round', baseAngle: -6, droopAngle: 44 },
    ],
    3: [
      { kind: 'path', d: 'M48 57 C48.6 47 47.6 37 48 29', stroke: 'stem', strokeWidth: 4.6 },
      { kind: 'leaf', x: 47, y: 50, dir: -1, shape: 'pointed', baseAngle: -16, droopAngle: 42 },
      { kind: 'leaf', x: 49.2, y: 43, dir: 1, shape: 'pointed', baseAngle: -14, droopAngle: 44 },
      { kind: 'leaf', x: 47.6, y: 35, dir: -1, shape: 'pointed', baseAngle: -22, droopAngle: 40 },
    ],
    4: [],
    5: [],
  },
};
HUONGDUONG.stages[4] = [
  ...HUONGDUONG.stages[3],
  sunflowerHead(48, 21, 1, { rotate: 26, cx: 48, cy: 29 }),
];
HUONGDUONG.stages[5] = [
  { kind: 'path', d: 'M48 57 C48.6 47 47.6 37 48 27', stroke: 'stem', strokeWidth: 5 },
  ...HUONGDUONG.stages[3].slice(1),
  { kind: 'leaf', x: 48.6, y: 30, dir: 1, shape: 'pointed', baseAngle: -26, droopAngle: 38 },
  // Bigger head, and the seeds that make it stage 5 rather than stage 4.
  sunflowerHead(48, 19, 1.22, { rotate: 30, cx: 48, cy: 27 }),
  {
    kind: 'group',
    droop: { rotate: 30, cx: 48, cy: 27 },
    parts: [
      { kind: 'circle', cx: 45, cy: 17, r: 1.5, fill: 'white', stroke: 'eyeInk', strokeWidth: 1.4 },
      { kind: 'circle', cx: 50.4, cy: 17.6, r: 1.5, fill: 'white', stroke: 'eyeInk', strokeWidth: 1.4 },
      { kind: 'circle', cx: 47.6, cy: 21.4, r: 1.5, fill: 'white', stroke: 'eyeInk', strokeWidth: 1.4 },
    ],
  },
];

/* ── ớt (chili) ────────────────────────────────────────────────────────────────────────────
 *
 * The one species whose fruit is not round: chilies are drawn as filled paths pointing UP, which
 * is both botanically right for a Vietnamese bird's-eye chili and the only way three red shapes
 * stay distinguishable at this size. Small white flowers, small leaves, a compact bush.
 */
const CHILI_POD = (d: string): PartSpec => ({
  kind: 'path',
  d,
  fill: 'fruit',
  stroke: 'fruitInk',
  strokeWidth: 3,
});

const OT: SpeciesArt = {
  id: 'ot',
  unlockAt: 4,
  palette: paletteOf({
    petal: OFF_WHITE,
    petalInk: mix(OFF_WHITE, DEEP, 0.34),
    eye: CREAM,
    eyeInk: inkOf(YELLOW),
    fruit: CHILI,
    fruitInk: inkOf(CHILI),
    gloss: 0,
  }),
  stages: {
    1: SEED_PARTS,
    2: [
      { kind: 'path', d: 'M48 57 C47.6 52.5 48.6 48 48.2 44', stroke: 'stem', strokeWidth: 4 },
      { kind: 'leaf', x: 46.8, y: 44.5, dir: -1, shape: 'round', scale: 0.9, baseAngle: -10, droopAngle: 42 },
      { kind: 'leaf', x: 49.4, y: 45.5, dir: 1, shape: 'round', scale: 0.9, baseAngle: -6, droopAngle: 44 },
    ],
    3: [
      { kind: 'path', d: 'M48 57 C47.4 48 49 40 48 33', stroke: 'stem', strokeWidth: 4.2 },
      { kind: 'path', d: 'M48.4 44 C52 41.5 55.5 39 57.5 35.5', stroke: 'stem', strokeWidth: 3 },
      { kind: 'leaf', x: 46.6, y: 50, dir: -1, shape: 'pointed', scale: 0.82, baseAngle: -20, droopAngle: 42 },
      { kind: 'leaf', x: 48.8, y: 41, dir: 1, shape: 'pointed', scale: 0.82, baseAngle: -16, droopAngle: 44 },
      { kind: 'leaf', x: 47.6, y: 35.5, dir: -1, shape: 'pointed', scale: 0.78, baseAngle: -26, droopAngle: 40 },
      { kind: 'leaf', x: 56.6, y: 36, dir: 1, shape: 'pointed', scale: 0.74, baseAngle: -20, droopAngle: 42 },
    ],
    4: [],
    5: [],
  },
};
OT.stages[4] = [
  ...OT.stages[3],
  {
    kind: 'group',
    droop: { rotate: 18, cx: 48, cy: 33 },
    parts: [
      { kind: 'petalRing', cx: 46, cy: 27, count: 5, rx: 3, ry: 4.2, dy: 4.2, petalStrokeWidth: 2.4 },
      { kind: 'circle', cx: 46, cy: 27, r: 2.2, fill: 'eye', stroke: 'eyeInk', strokeWidth: 2 },
    ],
  },
  {
    kind: 'group',
    droop: { rotate: 14, cx: 57.5, cy: 35.5 },
    parts: [
      { kind: 'petalRing', cx: 60, cy: 31, count: 5, rx: 2.4, ry: 3.4, dy: 3.4, petalStrokeWidth: 2.2 },
      { kind: 'circle', cx: 60, cy: 31, r: 1.8, fill: 'eye', stroke: 'eyeInk', strokeWidth: 1.8 },
    ],
  },
];
OT.stages[5] = [
  ...OT.stages[3],
  {
    kind: 'group',
    droop: { rotate: 12, cx: 48, cy: 45 },
    parts: [
      // Each pod: a fat teardrop tapering to a point at the top, plus its short green cap.
      CHILI_POD('M35 42 C32.6 35 33.6 27.5 35.6 23.5 C38.4 28 39.6 35.5 38.4 42 C37.6 44 35.8 44 35 42 Z'),
      { kind: 'path', d: 'M36.8 43 C35 45.5 33.6 47 31.6 47.6', stroke: 'stem', strokeWidth: 2.6 },
      CHILI_POD('M48.5 38 C46.4 31.5 47.6 24.5 49.6 21 C52 25.5 52.8 32 51.8 38 C51 40 49.2 40 48.5 38 Z'),
      { kind: 'path', d: 'M50 39 C49.6 41.5 49.4 43.5 49.6 45', stroke: 'stem', strokeWidth: 2.6 },
      CHILI_POD('M60.5 44 C58.6 38.5 59.6 32.5 61.4 29.5 C63.4 33.5 64 39 63.2 44 C62.4 45.8 61.2 45.8 60.5 44 Z'),
      { kind: 'path', d: 'M61.6 45 C60.6 47 59.4 48.5 57.6 49.4', stroke: 'stem', strokeWidth: 2.6 },
    ],
  },
];

// ART PENDING (Task 8)
const DAUTAY = pending(
  'dautay',
  6,
  paletteOf({
    petal: OFF_WHITE,
    petalInk: inkOf(OFF_WHITE),
    fruit: RED,
    fruitInk: inkOf(RED),
    gloss: 0.6,
  }),
);

// ART PENDING (Task 8)
const XUONGRONG = pending(
  'xuongrong',
  9,
  paletteOf({ petal: PINK, petalInk: inkOf(PINK), fruit: RED, fruitInk: inkOf(RED), gloss: 0.4 }),
);

// ART PENDING (Task 8)
const XOAI = pending(
  'xoai',
  12,
  paletteOf({
    petal: CREAM,
    petalInk: inkOf(CREAM),
    fruit: MANGO,
    fruitInk: inkOf(MANGO),
    gloss: 0.7,
  }),
);

// ART PENDING (Task 9)
const QUAT = pending(
  'quat',
  16,
  paletteOf({
    petal: OFF_WHITE,
    petalInk: inkOf(OFF_WHITE),
    fruit: KUMQUAT,
    fruitInk: inkOf(KUMQUAT),
    gloss: 0.7,
  }),
);

// ART PENDING (Task 9)
const DAO = pending(
  'dao',
  20,
  paletteOf({
    petal: BLOSSOM,
    petalInk: inkOf(BLOSSOM),
    fruit: BLOSSOM,
    fruitInk: inkOf(BLOSSOM),
    gloss: 0,
  }),
);

// ART PENDING (Task 9)
const MAI = pending(
  'mai',
  25,
  paletteOf({
    petal: YELLOW,
    petalInk: inkOf(YELLOW),
    fruit: YELLOW,
    fruitInk: inkOf(YELLOW),
    gloss: 0,
  }),
);

/** Ordered by unlock threshold — the order the picker shows them in. */
export const SPECIES: SpeciesArt[] = [
  CLASSIC,
  CACHUA,
  HUONGDUONG,
  OT,
  DAUTAY,
  XUONGRONG,
  XOAI,
  QUAT,
  DAO,
  MAI,
];

/* ── lookups ───────────────────────────────────────────────────────────────────────────── */

/**
 * An id the registry does not know reads as `classic`, never as a blank pot: a snapshot frozen
 * before species existed, a row written by a newer deployment, and a typo all land here.
 */
export function speciesOf(id: string | null | undefined): SpeciesArt {
  return SPECIES.find((s) => s.id === id) ?? CLASSIC;
}

export function unlockedSpecies(fruitsTotal: number): SpeciesArt[] {
  return SPECIES.filter((s) => s.unlockAt <= fruitsTotal);
}

/** The next species this student is working toward, or null once they have them all. */
export function nextUnlock(fruitsTotal: number): SpeciesArt | null {
  return SPECIES.find((s) => s.unlockAt > fruitsTotal) ?? null;
}

/** What a harvest just opened up: species whose threshold falls in (before, after]. */
export function newlyUnlocked(before: number, after: number): SpeciesArt[] {
  return SPECIES.filter((s) => s.unlockAt > before && s.unlockAt <= after);
}
