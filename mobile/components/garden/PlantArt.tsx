import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { categoryColor, type ColorIdKey } from '@mochi/shared/tokens';
import {
  LOCKED_PALETTE,
  inkOf,
  mix,
  softOf,
  speciesOf,
  type PartSpec,
  type SpeciesPalette,
} from '@mochi/shared/garden-art';

/**
 * Vocabulary-garden artwork (cây từ vựng) — the React Native renderer.
 *
 * The plant itself is DATA, shared with the web: `shared/garden-art.ts` holds every species' parts
 * per stage, and both this file and `src/garden/plant-art.tsx` draw the same list. That is what
 * stops the two clients from drifting into two different gardens — there is nothing left to
 * hand-port when a species is added. Read the shared module for what the stages mean.
 *
 * Four deliberate differences from the web renderer, all forced by react-native-svg:
 *
 *  1. **`fill="none"` is explicit on every stroke-only shape.** The web sets it once on the root
 *     `<svg>` and lets it inherit; RN SVG defaults a shape's fill to BLACK, so an inherited-fill
 *     path would render as a black blob. `strokeWidth`/`strokeLinecap` are explicit likewise.
 *  2. **Three-argument `rotate(a cx cy)` becomes `<G rotation origin>`.** The string form is a web
 *     SVG convenience this renderer does not parse the same way — which is exactly why every
 *     rotation in the shared data carries its own origin.
 *  3. **The wilt is a palette, not a filter.** The web desaturates with CSS
 *     `filter: saturate(0.55)`; RN SVG has no filters, so `wiltedOf` bakes the species' own palette
 *     greyer. This is why the wilt still shows under reduced motion: it is colour, which carries
 *     state, not animation.
 *  4. **Animations are Reanimated on a wrapping `View`, never on SVG internals.** All four web
 *     animations (pop, sway, droop, harvest) are whole-drawing transforms, so a wrapper is enough
 *     and the SVG subtree stays static.
 *
 * The six pot hues come from `categoryColor` in shared/tokens — the same six the database stores.
 */

/* ── chrome colours (the plant's own live in the registry) ────────────────────────────────── */

const WHITE = '#FFFFFF';
const ASH = '#8C857D';

/** `categoryColor[id].base` is the same literal the web reads as `colorOf(id).hex`. */
const hexOf = (id: string | null | undefined): string =>
  categoryColor[(id ?? 'violet') as ColorIdKey]?.base ?? categoryColor.violet.base;

const SOIL = categoryColor.cocoa.base;
const SOIL_INK = categoryColor.cocoa.ink;
// The class tree is not a species — it has one look for every class, so it keeps its own two hues.
const GREEN = hexOf('green');
const YELLOW = '#F5C24B';

/**
 * Wilted: the web's `saturate(0.55)` rebuilt as pigment.
 *
 * 0.45 toward ASH is the mix that reads closest to the filter — enough that a wilting plant is
 * obviously off-colour at 96px, not so much that it looks dead, which is a different state with its
 * own palette below. The gloss dims but does not vanish: a wilting plant's fruit is still fruit.
 * Applied to whichever species is planted, so a wilting chili wilts in chili colours.
 */
const wiltOf = (hex: string) => mix(hex, ASH, 0.45);
function wiltedOf(p: SpeciesPalette): SpeciesPalette {
  const out = { ...p, gloss: 0.35 };
  for (const role of Object.keys(p) as (keyof SpeciesPalette)[]) {
    if (role !== 'gloss' && role !== 'white') (out[role] as string) = wiltOf(p[role] as string);
  }
  return out;
}

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
/** The soil is chrome, so its hexes live here rather than on any species' palette. */
const DEAD_SOIL = '#7F7566';

/** Pot fill/rim. Dead and wilted both drain the hue, but keep it — students know their own pot. */
function potColors(id: string | undefined, dead: boolean, wilted: boolean) {
  const base = hexOf(id);
  const tint = dead ? mix(base, ASH, 0.7) : wilted ? mix(base, ASH, 0.45) : base;
  return { fill: softOf(tint), line: inkOf(tint) };
}

/* ── parts ────────────────────────────────────────────────────────────────────────────────── */

/** Deeper than it is wide across the rim, or it reads as a casserole dish, not a plant pot. */
function Pot({ fill, line }: { fill: string; line: string }) {
  return (
    <>
      <Path
        d="M27.5 65.5 L32.5 85 Q33.5 89 38 89 L58 89 Q62.5 89 63.5 85 L68.5 65.5 Z"
        fill={fill}
        stroke={line}
        strokeWidth={4.2}
      />
      {/* rim, drawn over the body so the join needs no clipping */}
      <Rect
        x={24}
        y={56}
        width={48}
        height={10}
        rx={5}
        fill={fill}
        stroke={line}
        strokeWidth={4.2}
      />
    </>
  );
}

/**
 * Dirt seen through the pot's opening — a lens that stays clear of the rim's top stroke, so the
 * rim keeps its outline and the soil never reads as a lid sitting on top of the pot.
 */
function Soil({ fill }: { fill: string }) {
  return (
    <Path
      d="M26.5 58.8 Q36 57.9 48 57.7 Q60 57.9 69.5 58.8 Q60 62.6 48 63 Q36 62.6 26.5 58.8 Z"
      fill={fill}
    />
  );
}

/**
 * The hill of soil that says something has been planted. Its flat bottom hides inside the rim's
 * top stroke, so the hill needs no seam and the rim still passes behind it.
 */
function Mound({ fill, line }: { fill: string; line: string }) {
  return (
    <Path
      d="M33 58 Q38 52.2 48 51.4 Q58 52.2 63 58 Z"
      fill={fill}
      stroke={line}
      strokeWidth={3.6}
    />
  );
}

/**
 * A smaller unstroked copy of the mound, painted last so the stem and the seed appear to come
 * out of the soil instead of standing on it.
 */
function SoilLip({ fill }: { fill: string }) {
  return <Path d="M38.5 58 Q43 54.5 48 54 Q53 54.5 57.5 58 Z" fill={fill} />;
}

/** Four-point star. Only used for the empty-pot hint. */
function Sparkle({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Path d="M0 -6 C1 -2 2 -1 6 0 C2 1 1 2 0 6 C-1 2 -2 1 -6 0 C-2 -1 -1 -2 0 -6 Z" fill={fill} />
    </G>
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
    <G transform={`translate(${x} ${y}) scale(${dir * scale} ${scale}) rotate(${angle})`}>
      <Path
        d={
          round
            ? 'M0 0 C1 -8 10.5 -11 14.8 -5.4 C15.6 1 8 5.6 0 0 Z'
            : 'M0 0 C4.5 -8 14 -9.5 19 -3.2 C13 4 4.5 5 0 0 Z'
        }
        fill={fill}
        stroke={line}
        strokeWidth={3.4}
      />
      <Path
        d={round ? 'M1.6 -0.6 C5.5 -2.6 9.5 -3.6 12.6 -3.4' : 'M1.5 -0.4 C7 -2.5 12 -3.6 16.6 -3.4'}
        fill="none"
        stroke={line}
        strokeWidth={2.1}
        opacity={0.7}
        strokeLinecap="round"
      />
    </G>
  );
}

/* ── the parts renderer ───────────────────────────────────────────────────────────────────── */

/**
 * One registry part → one RN SVG element. The mirror of `renderPart` in the web renderer, with
 * the three RN adaptations from the header: fills are always explicit, rotations become
 * `<G rotation origin>`, and stroke caps are spelled out because nothing inherits.
 */
function renderPart(
  part: PartSpec,
  p: SpeciesPalette,
  droop: boolean,
  key: string,
): React.ReactElement {
  const hue = (role: keyof SpeciesPalette | undefined) =>
    role === undefined ? 'none' : (p[role] as string);

  switch (part.kind) {
    case 'path':
      return (
        <Path
          key={key}
          d={part.d}
          fill={hue(part.fill)}
          stroke={hue(part.stroke)}
          strokeWidth={part.strokeWidth}
          opacity={part.opacity}
          strokeDasharray={part.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'circle':
      return (
        <Circle
          key={key}
          cx={part.cx}
          cy={part.cy}
          r={part.r}
          fill={hue(part.fill)}
          stroke={hue(part.stroke)}
          strokeWidth={part.strokeWidth}
        />
      );
    case 'ellipse': {
      const el = (
        <Ellipse
          cx={part.cx}
          cy={part.cy}
          rx={part.rx}
          ry={part.ry}
          fill={hue(part.fill)}
          stroke={hue(part.stroke)}
          strokeWidth={part.strokeWidth}
        />
      );
      return part.rotate ? (
        <G key={key} rotation={part.rotate.deg} origin={`${part.rotate.cx}, ${part.rotate.cy}`}>
          {el}
        </G>
      ) : (
        <G key={key}>{el}</G>
      );
    }
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
        <G key={key}>
          {Array.from({ length: part.count }, (_, i) => (
            <G key={i} rotation={i * step} origin={`${part.cx}, ${part.cy}`}>
              <Ellipse
                cx={part.cx}
                cy={part.cy - part.dy}
                rx={part.rx}
                ry={part.ry}
                fill={p.petal}
                stroke={p.petalInk}
                strokeWidth={part.petalStrokeWidth ?? 3.2}
              />
            </G>
          ))}
        </G>
      );
    }
    case 'fruit': {
      const { cx, cy, r } = part;
      return (
        <G key={key}>
          <Path
            d={part.stalk}
            fill="none"
            stroke={p.stem}
            strokeWidth={3.4}
            strokeLinecap="round"
          />
          <Circle cx={cx} cy={cy} r={r} fill={p.fruit} stroke={p.fruitInk} strokeWidth={3.2} />
          {p.gloss > 0 && (
            <Path
              d={`M${cx - r * 0.55} ${cy - r * 0.3} C${cx - r * 0.5} ${cy - r * 0.75} ${cx - r * 0.1} ${cy - r * 0.9} ${cx + r * 0.2} ${cy - r * 0.8}`}
              fill="none"
              stroke={p.white}
              strokeWidth={2.2}
              opacity={p.gloss * 0.75}
              strokeLinecap="round"
            />
          )}
        </G>
      );
    }
    case 'group': {
      const children = part.parts.map((child, i) => renderPart(child, p, droop, `${key}.${i}`));
      const inner = part.transform ? <G transform={part.transform}>{children}</G> : <G>{children}</G>;
      const d = droop ? part.droop : undefined;
      if (!d) return <G key={key}>{inner}</G>;
      // Rotation carries its own origin (the whole reason the data spells it out); translate is
      // the sag the classic fruits use.
      return 'rotate' in d ? (
        <G key={key} rotation={d.rotate} origin={`${d.cx}, ${d.cy}`}>
          {inner}
        </G>
      ) : (
        <G key={key} translateX={d.translate[0]} translateY={d.translate[1]}>
          {inner}
        </G>
      );
    }
  }
}

/* ── the plant ────────────────────────────────────────────────────────────────────────────── */

// Timings mirror the CSS in src/styles/app.css (the garden block) via shared/tokens `motion`.
const DUR_SLOW = 320;
const SWAY_MS = 4500;
const HARVEST_MS = 320;
const CONFETTI_MS = 1700;

export type PlantStageValue = 0 | 1 | 2 | 3 | 4 | 5;

export function PlantSvg({
  stage,
  wilted = false,
  dead = false,
  potColor = 'cocoa',
  species = 'classic',
  locked = false,
  size = 96,
  animateStageUp = false,
  sway = false,
  harvesting = false,
}: {
  stage: PlantStageValue;
  wilted?: boolean;
  dead?: boolean;
  /** Palette id — violet | green | blue | orange | cocoa | rose. */
  potColor?: string;
  /** Species id from shared/garden-art.ts. An unknown id draws the classic plant. */
  species?: string;
  /** Draw as a grey silhouette — the picker's preview of a species not yet earned. */
  locked?: boolean;
  size?: number;
  /** One-shot pop, for the round that grew the plant. */
  animateStageUp?: boolean;
  /** Idle rocking. Opt-in, unlike the web, so a grid of 20 cards is not 20 running timers. */
  sway?: boolean;
  /** The plant drops out of frame — the harvest celebration. */
  harvesting?: boolean;
}): React.ReactElement {
  // Death is not a stage, it is a state: whatever the student had grown, a dead plant is a dead
  // plant, so the dead drawing and palette win over `stage` and over the species.
  const art = speciesOf(species);
  const live = locked ? LOCKED_PALETTE : art.palette;
  const p = dead ? DEAD : wilted ? wiltedOf(live) : live;
  const pot = potColors(potColor, dead, wilted && !dead);
  const droop = wilted && !dead;
  const soil = dead ? DEAD_SOIL : wilted ? wiltOf(SOIL) : SOIL;
  const parts = stage >= 1 && stage <= 5 ? art.stages[stage as 1 | 2 | 3 | 4 | 5] : [];

  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const dropY = useSharedValue(0);
  const fade = useSharedValue(1);

  // The droop is a resting position, not a flourish, so it is applied even under reduced motion —
  // it just arrives instantly. Same reasoning as keeping the wilted palette.
  React.useEffect(() => {
    const target = droop ? 4 : 0;
    if (reduced) {
      rotate.value = target;
      return;
    }
    if (sway && !droop && !dead && !animateStageUp && stage >= 2) {
      // Rocks from the pot rather than the middle of the plant — the wrapper's origin is its
      // bottom edge, which is where the pot foot sits in the viewBox.
      rotate.value = -2;
      rotate.value = withRepeat(
        withTiming(2, { duration: SWAY_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
      return;
    }
    rotate.value = withTiming(target, { duration: DUR_SLOW, easing: Easing.out(Easing.quad) });
  }, [droop, sway, dead, animateStageUp, stage, reduced, rotate]);

  React.useEffect(() => {
    if (!animateStageUp || reduced) return;
    scale.value = withSequence(
      withTiming(0.82, { duration: 0 }),
      withTiming(1.06, { duration: DUR_SLOW * 0.6, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: DUR_SLOW * 0.4, easing: Easing.out(Easing.quad) }),
    );
  }, [animateStageUp, reduced, scale]);

  React.useEffect(() => {
    if (!harvesting) {
      dropY.value = 0;
      fade.value = 1;
      return;
    }
    if (reduced) {
      fade.value = 0;
      return;
    }
    dropY.value = withTiming(14, { duration: HARVEST_MS, easing: Easing.out(Easing.quad) });
    fade.value = withTiming(0, { duration: HARVEST_MS });
  }, [harvesting, reduced, dropY, fade]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { translateY: dropY.value },
      // Pivot at the pot's foot: translate down, rotate, translate back. RN has no
      // `transform-origin`, and rotating about the centre makes the pot swing like a pendulum.
      { translateY: size / 2 },
      { rotate: `${rotate.value}deg` },
      { translateY: -size / 2 },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, animStyle]}>
      <Svg width={size} height={size} viewBox="0 0 96 96" fill="none">
        <Pot fill={pot.fill} line={pot.line} />
        <Soil fill={soil} />
        {(dead || stage >= 1) && <Mound fill={soil} line={p.soilInk} />}

        {stage === 0 && !dead && (
          // Nothing planted: a dashed arch where the plant will be, plus sparkles, so the empty
          // pot reads as an invitation rather than as a failure.
          <G opacity={0.42}>
            <Path
              d="M39 53 C36.5 42 43 34.5 48 34.5 C53 34.5 59.5 42 57 53"
              fill="none"
              stroke={p.soilInk}
              strokeWidth={2.8}
              strokeDasharray="3.5 5.5"
              strokeLinecap="round"
            />
            <Sparkle x={48} y={26} s={1.15} fill={p.soilInk} />
            <Sparkle x={60.5} y={35} s={0.6} fill={p.soilInk} />
            <Sparkle x={36} y={38} s={0.45} fill={p.soilInk} />
          </G>
        )}

        {dead ? (
          // One bare stalk, leaning and snapped, with the broken piece hanging on the same side as
          // the lean. Both pieces stay on one side: an arc coming back down towards the pot closes
          // the silhouette and the whole thing turns into a basket with a handle.
          <G>
            <Path
              d="M48 57 C47.5 47 45.5 38 41.5 32.5"
              fill="none"
              stroke={p.stem}
              strokeWidth={4.2}
              strokeLinecap="round"
            />
            <Path
              d="M38.2 31.6 C34.2 34.4 33.4 39.6 35.4 44.6"
              fill="none"
              stroke={p.stem}
              strokeWidth={3.4}
              strokeLinecap="round"
            />
            {/* frayed hairs at the break — the cartoon shorthand for "snapped" */}
            <Path
              d="M41 30.6 L43.2 28.4"
              fill="none"
              stroke={p.stem}
              strokeWidth={1.9}
              opacity={0.75}
              strokeLinecap="round"
            />
            <Path
              d="M37.6 34 L35 32.8"
              fill="none"
              stroke={p.stem}
              strokeWidth={1.9}
              opacity={0.75}
              strokeLinecap="round"
            />
            {/* one leaf still attached, hanging straight down */}
            <Leaf x={46.8} y={38} dir={-1} angle={74} scale={0.68} fill={p.leaf} line={p.leafInk} />
            {/* and one lying where it fell — the detail that sells "chết queo" */}
            <Leaf x={56} y={52.6} dir={1} angle={32} scale={0.62} fill={p.leaf} line={p.leafInk} />
          </G>
        ) : (
          <G rotation={droop ? 7 : 0} origin="48, 57">
            {parts.map((part, i) => renderPart(part, p, droop, String(i)))}
          </G>
        )}

        {/* Only once something is in the ground — over flat soil the lip would just look like a
            second, taller mound. */}
        {(dead || stage >= 1) && <SoilLip fill={soil} />}
      </Svg>
    </Animated.View>
  );
}

/* ── confetti ─────────────────────────────────────────────────────────────────────────────── */

/** Left offset (as a fraction) and start delay, matching the web's nth-child stagger. */
const CONFETTI: { left: number; delay: number }[] = [
  { left: 0.06, delay: 0 },
  { left: 0.17, delay: 140 },
  { left: 0.28, delay: 60 },
  { left: 0.39, delay: 260 },
  { left: 0.48, delay: 30 },
  { left: 0.57, delay: 320 },
  { left: 0.68, delay: 110 },
  { left: 0.77, delay: 400 },
  { left: 0.86, delay: 200 },
  { left: 0.94, delay: 470 },
];

function ConfettiPiece({
  left,
  delay,
  fall,
  color,
}: {
  left: number;
  delay: number;
  fall: number;
  color: string;
}) {
  const y = useSharedValue(0);
  const spin = useSharedValue(0);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    const ease = { duration: CONFETTI_MS, easing: Easing.out(Easing.quad) };
    y.value = withDelay(delay, withTiming(fall, ease));
    spin.value = withDelay(delay, withTiming(240, ease));
    opacity.value = withDelay(
      delay,
      withSequence(
        withTiming(1, { duration: CONFETTI_MS * 0.12 }),
        withTiming(0, { duration: CONFETTI_MS * 0.88 }),
      ),
    );
  }, [delay, fall, y, spin, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: y.value }, { rotate: `${spin.value}deg` }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: -14,
          left: `${left * 100}%`,
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/**
 * Ten pieces falling past whatever it wraps. Absolutely positioned and non-interactive, so it can
 * be dropped over a plant without touching the layout.
 *
 * Silent under reduced motion: confetti is pure decoration, and unlike the wilt it carries no
 * information — a still frame of it would just be ten dots stuck to the card.
 */
export function Confetti({ height, color }: { height: number; color: string }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      {CONFETTI.map((c) => (
        <ConfettiPiece
          key={c.left}
          left={c.left}
          delay={c.delay}
          fall={height + 28}
          color={color}
        />
      ))}
    </View>
  );
}

/* ── the class tree ───────────────────────────────────────────────────────────────────────── */

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
}: {
  level: number;
  size?: number;
}): React.ReactElement {
  const lv = Math.max(0, Math.min(10, Math.round(level || 0)));
  const clusters = lv === 0 ? 0 : Math.max(1, Math.round((lv / 10) * CANOPY.length));
  const blooms = lv >= 6 ? Math.min(BLOSSOMS.length, lv - 5) : 0;
  const leaf = GREEN;
  const leafInk = inkOf(leaf);

  return (
    <Svg width={size} height={size} viewBox="0 0 96 96" fill="none">
      <Path
        d="M20 85 Q48 89.5 76 85"
        fill="none"
        stroke={SOIL}
        strokeWidth={4.2}
        opacity={0.9}
        strokeLinecap="round"
      />
      <Path
        d="M48.5 86 C47.6 76 48 66 48 54"
        fill="none"
        stroke={SOIL_INK}
        strokeWidth={6.5}
        strokeLinecap="round"
      />
      <Path
        d="M48 63 C43.5 59 38.5 55 33.5 52.5"
        fill="none"
        stroke={SOIL_INK}
        strokeWidth={4.6}
        strokeLinecap="round"
      />
      <Path
        d="M48 58 C53 54.5 58.5 50.5 63.5 48.5"
        fill="none"
        stroke={SOIL_INK}
        strokeWidth={4.6}
        strokeLinecap="round"
      />
      <Path
        d="M48 54 C47 49 47.6 44 48 40"
        fill="none"
        stroke={SOIL_INK}
        strokeWidth={4.6}
        strokeLinecap="round"
      />

      {/* Outlines first, fills on top: each stroke survives only where it sticks out past its
          neighbours, so the clusters read as one canopy with a clean silhouette instead of a
          pile of circles with lines through it. */}
      {CANOPY.slice(0, clusters).map((c) => (
        <Circle
          key={`s${c.cx}-${c.cy}`}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          fill="none"
          stroke={leafInk}
          strokeWidth={3.6}
        />
      ))}
      {CANOPY.slice(0, clusters).map((c) => (
        <Circle key={`f${c.cx}-${c.cy}`} cx={c.cx} cy={c.cy} r={c.r} fill={leaf} />
      ))}

      {BLOSSOMS.slice(0, blooms).map((b) => (
        <Circle
          key={`b${b.cx}`}
          cx={b.cx}
          cy={b.cy}
          r={3.4}
          fill={YELLOW}
          stroke={inkOf(YELLOW)}
          strokeWidth={2.4}
        />
      ))}
    </Svg>
  );
}

/** i18n key suffix for the stage label, e.g. 'garden_stage_2'. Mirrors the web's `stageKey`. */
export function stageKey(stage: number, dead?: boolean): string {
  if (dead) return 'garden_stage_dead';
  return `garden_stage_${Math.max(0, Math.min(5, Math.round(stage || 0)))}`;
}

/** Narrow a server-sent number to the stage union the drawing accepts. */
export function clampStage(stage: number): PlantStageValue {
  return Math.max(0, Math.min(5, Math.round(stage || 0))) as PlantStageValue;
}
