/**
 * Swipe-to-mark tuning for the flashcard flip game, shared by web and mobile.
 *
 * These numbers are the result of real iteration (commits 24c4b28, e9f3d43, 1a44469) and are
 * the single source of truth for how the gesture FEELS. If the mobile port feels different
 * from the web, the port is wrong — do not compensate by changing the values here.
 *
 * Pure arithmetic: no React, no DOM, no React Native. The web composes these into a CSS
 * transform string; mobile feeds them to Reanimated shared values.
 */

/** Movement (px) before a press becomes a drag. Below this it stays a tap, which flips the card. */
export const DRAG_SLOP_PX = 8;
/** Degrees of tilt per horizontal px dragged. */
export const ROT_PER_PX = 0.07;
export const MAX_ROT_DEG = 15;
/** Pendulum arc: dy = -(dx^2) * ARC_K — the card rises as it swings sideways. */
export const ARC_K = 1 / 1600;
/** Cap on the rise, so the exit toss doesn't fly off the top. */
export const MAX_LIFT_PX = 140;
/** Drag distance, as a fraction of card width, that commits the swipe. */
export const COMMIT_RATIO = 0.35;
/** px/ms — a fast flick commits even below the distance threshold. */
export const FLICK_VX = 0.5;
/** Minimum travel (px) before a flick counts, so a stationary jitter can't commit. */
export const FLICK_MIN_DX = 24;
/** Fly-out duration, ms. */
export const EXIT_MS = 280;

/** Vertical offset on the pendulum arc. Always <= 0 (upward), clamped to MAX_LIFT_PX. */
export function arcLift(dx: number): number {
  return -Math.min(MAX_LIFT_PX, dx * dx * ARC_K);
}

/** Card tilt in degrees, clamped to +/- MAX_ROT_DEG. */
export function arcRotation(dx: number): number {
  return Math.max(-MAX_ROT_DEG, Math.min(MAX_ROT_DEG, dx * ROT_PER_PX));
}

/**
 * Should the drag commit to a swipe, or spring back?
 *
 * True if it travelled far enough, OR was a fast flick in a consistent direction.
 *
 * @param dx        horizontal travel in px (positive = right = "known")
 * @param vx        horizontal velocity in **px per millisecond**. Reanimated reports
 *                  velocity in px/SECOND — divide by 1000 before calling this.
 * @param cardWidth measured card width in px
 */
export function shouldCommit(dx: number, vx: number, cardWidth: number): boolean {
  const farEnough = Math.abs(dx) > cardWidth * COMMIT_RATIO;
  const flicked =
    Math.abs(vx) > FLICK_VX && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > FLICK_MIN_DX;
  return farEnough || flicked;
}
