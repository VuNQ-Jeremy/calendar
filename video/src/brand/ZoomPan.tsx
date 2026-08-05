import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { ease, timing } from './theme';

export type Rect = { x: number; y: number; width: number; height: number };

export type ZoomKey = {
  /** Frame (composition-relative) at which this zoom state starts easing in. */
  startFrame: number;
  /** Target in viewport CSS pixels, as recorded by Playwright. `null` = full frame. */
  target: Rect | null;
};

type State = { scale: number; originX: number; originY: number };

const WIDE: State = { scale: 1, originX: 0.5, originY: 0.5 };

/**
 * How much to magnify a target: enough that it fills a bit over half the frame,
 * capped low on purpose.
 *
 * The footage is a 1600×900 capture already shown at 1920×1080, so it is upscaled
 * 1.2× before any of this applies (see record/recorder.ts for why the capture cannot
 * be bigger). Every extra tenth compounds on that, and past roughly 1.25 the app's
 * text visibly softens — so the cap is deliberately modest and most steps are meant
 * to sit near it rather than push past.
 */
function stateFor(target: Rect | null, viewport: { width: number; height: number }): State {
  if (!target) return WIDE;
  const wanted = (viewport.width * 0.5) / Math.max(target.width, 1);
  const scale = Math.min(1.22, Math.max(1.06, wanted));
  return {
    scale,
    originX: (target.x + target.width / 2) / viewport.width,
    originY: (target.y + target.height / 2) / viewport.height,
  };
}

/**
 * Wraps the footage and eases between zoom states.
 *
 * Scaling about a transform-origin placed on the target keeps that element
 * pinned where the viewer last saw it while everything else grows around it —
 * which reads as a camera push rather than a jump cut, and can never expose an
 * empty edge the way a translate-based pan can.
 */
export const ZoomPan: React.FC<{
  keys: ZoomKey[];
  viewport: { width: number; height: number };
  children: React.ReactNode;
}> = ({ keys, viewport, children }) => {
  const frame = useCurrentFrame();

  const sorted = [...keys].sort((a, b) => a.startFrame - b.startFrame);
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].startFrame <= frame) idx = i;
  }

  let current: State;
  if (idx < 0) {
    current = WIDE;
  } else {
    const to = stateFor(sorted[idx].target, viewport);
    const from = idx === 0 ? WIDE : stateFor(sorted[idx - 1].target, viewport);
    const start = sorted[idx].startFrame;
    const opts = {
      extrapolateLeft: 'clamp' as const,
      extrapolateRight: 'clamp' as const,
      easing: ease.inOut,
    };
    const range: [number, number] = [start, start + timing.zoom];
    current = {
      scale: interpolate(frame, range, [from.scale, to.scale], opts),
      originX: interpolate(frame, range, [from.originX, to.originX], opts),
      originY: interpolate(frame, range, [from.originY, to.originY], opts),
    };
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        transform: `scale(${current.scale})`,
        transformOrigin: `${current.originX * 100}% ${current.originY * 100}%`,
      }}
    >
      {children}
    </div>
  );
};
