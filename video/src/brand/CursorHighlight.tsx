import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { ramp, ease } from './theme';

/**
 * A pulsing ring over the point the script clicked, so the viewer's eye arrives
 * before the UI reacts. Positioned in the footage's own coordinate space (the
 * element this renders into must overlay the video 1:1).
 */
export const CursorHighlight: React.FC<{
  point: { x: number; y: number };
  viewport: { width: number; height: number };
  /** Ring diameter in viewport pixels at rest. */
  size?: number;
  /** Number of pulses before it settles. */
  pulses?: number;
}> = ({ point, viewport, size = 76, pulses = 2 }) => {
  const frame = useCurrentFrame();
  const period = 22;
  const t = (frame % period) / period;
  const cycle = Math.floor(frame / period);
  const active = cycle < pulses;

  const scale = active ? interpolate(t, [0, 1], [0.6, 1.7], { easing: ease.out }) : 1;
  const ringOpacity = active ? interpolate(t, [0, 0.75, 1], [0, 0.85, 0]) : 0;
  const dotOpacity = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        position: 'absolute',
        left: `${(point.x / viewport.width) * 100}%`,
        top: `${(point.y / viewport.height) * 100}%`,
        width: `${(size / viewport.width) * 100}%`,
        aspectRatio: '1 / 1',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 999,
          border: `4px solid ${ramp.orange[400]}`,
          transform: `scale(${scale})`,
          opacity: ringOpacity,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: '30%',
          borderRadius: 999,
          background: ramp.orange[400],
          opacity: dotOpacity * 0.35,
        }}
      />
    </div>
  );
};
