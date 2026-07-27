import { describe, it, expect } from 'vitest';
import {
  DRAG_SLOP_PX,
  ROT_PER_PX,
  MAX_ROT_DEG,
  ARC_K,
  MAX_LIFT_PX,
  COMMIT_RATIO,
  FLICK_VX,
  EXIT_MS,
  arcLift,
  arcRotation,
  shouldCommit,
} from '../shared/logic/flip-gesture';

/**
 * The flip gesture is the most-tuned code in the app. This locks in the exact behaviour the
 * web had before the constants moved to shared/, so the mobile port (phase 3) has a
 * reference and so nobody "improves" the feel by accident.
 *
 * The reference implementations below are copied verbatim from game-flip.tsx as it stood at
 * commit ac7039d. Do not refactor them to call the shared helpers — that would defeat the test.
 */

const REF = {
  arcTransform(dx: number): string {
    const rot = Math.max(-15, Math.min(15, dx * 0.07));
    const dy = -Math.min(140, dx * dx * (1 / 1600));
    return `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
  },
  commit(dx: number, vx: number, width: number): boolean {
    return (
      Math.abs(dx) > width * 0.35 ||
      (Math.abs(vx) > 0.5 && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > 24)
    );
  },
};

const SAMPLES = [
  -600, -420, -300, -240, -180, -140, -100, -60, -40, -24, -8, -1, 0, 1, 8, 24, 40, 60, 100, 140,
  180, 240, 300, 420, 600,
];

describe('flip gesture constants', () => {
  it('kept their original values', () => {
    expect(DRAG_SLOP_PX).toBe(8);
    expect(ROT_PER_PX).toBe(0.07);
    expect(MAX_ROT_DEG).toBe(15);
    expect(ARC_K).toBe(1 / 1600);
    expect(MAX_LIFT_PX).toBe(140);
    expect(COMMIT_RATIO).toBe(0.35);
    expect(FLICK_VX).toBe(0.5);
    expect(EXIT_MS).toBe(280);
  });
});

describe('arc maths match the pre-extraction implementation', () => {
  it('produces an identical transform for every sample offset', () => {
    for (const dx of SAMPLES) {
      const composed = `translate(${dx}px, ${arcLift(dx)}px) rotate(${arcRotation(dx)}deg)`;
      expect(composed, `dx=${dx}`).toBe(REF.arcTransform(dx));
    }
  });

  it('lift is always upward and capped', () => {
    for (const dx of SAMPLES) {
      expect(arcLift(dx)).toBeLessThanOrEqual(0);
      expect(arcLift(dx)).toBeGreaterThanOrEqual(-MAX_LIFT_PX);
    }
  });

  it('rotation is clamped both ways', () => {
    expect(arcRotation(100_000)).toBe(MAX_ROT_DEG);
    expect(arcRotation(-100_000)).toBe(-MAX_ROT_DEG);
    expect(arcRotation(0)).toBe(0);
  });
});

describe('shouldCommit matches the pre-extraction heuristic', () => {
  const widths = [320, 480, 720];
  const velocities = [-2, -0.6, -0.5, -0.49, 0, 0.49, 0.5, 0.6, 2];

  it('agrees across the full sample grid', () => {
    for (const width of widths) {
      for (const dx of SAMPLES) {
        for (const vx of velocities) {
          expect(shouldCommit(dx, vx, width), `dx=${dx} vx=${vx} w=${width}`).toBe(
            REF.commit(dx, vx, width),
          );
        }
      }
    }
  });

  it('commits on distance alone past the ratio', () => {
    expect(shouldCommit(0.36 * 480, 0, 480)).toBe(true);
    expect(shouldCommit(0.34 * 480, 0, 480)).toBe(false);
  });

  it('commits on a fast flick below the distance threshold', () => {
    expect(shouldCommit(30, 0.8, 480)).toBe(true);
  });

  it('ignores a fast flick in the opposite direction', () => {
    expect(shouldCommit(30, -0.8, 480)).toBe(false);
  });

  it('ignores a fast flick that barely moved', () => {
    expect(shouldCommit(20, 0.8, 480)).toBe(false);
  });
});
