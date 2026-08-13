import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { font } from './fonts';
import { ramp, radius, semantic, shadowCss, softSpring, timing } from './theme';

/** Orange circle with the step number, in mono. */
export const StepBadge: React.FC<{ n: number; size: number }> = ({ n, size }) => (
  <div
    style={{
      width: size,
      height: size,
      flex: `0 0 ${size}px`,
      borderRadius: 999,
      background: ramp.orange[400],
      color: '#FFFFFF',
      fontFamily: font.mono,
      fontWeight: 500,
      fontSize: size * 0.5,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 1,
    }}
  >
    {n}
  </div>
);

/**
 * The caption pill: white card, orange leading bar, step number, Vietnamese text.
 * Springs up on entry and fades on exit, so consecutive captions cross-dissolve
 * rather than snapping.
 */
export const LowerThird: React.FC<{
  text: string;
  step?: number;
  /** Frames this caption is on screen; drives the exit fade. */
  durationInFrames: number;
  unit: number;
  typeScale?: number;
  maxWidth?: number;
  /** Which edge it slides in from — match the edge it is anchored to. */
  from?: 'bottom' | 'top';
}> = ({ text, step, durationInFrames, unit, typeScale = 1, maxWidth, from = 'bottom' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const rise = spring({ frame, fps, config: softSpring });
  const out = interpolate(frame, [durationInFrames - timing.captionOut, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const pad = 22 * unit * typeScale;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18 * unit * typeScale,
        background: semantic.surfaceCard,
        borderRadius: radius.pill,
        boxShadow: shadowCss.lg,
        padding: `${pad}px ${pad * 1.5}px ${pad}px ${pad}px`,
        maxWidth,
        transform: `translateY(${(1 - rise) * 40 * unit * (from === 'top' ? -1 : 1)}px)`,
        opacity: Math.min(rise, out),
      }}
    >
      {step === undefined ? (
        <div
          style={{
            width: 6 * unit * typeScale,
            alignSelf: 'stretch',
            minHeight: 40 * unit * typeScale,
            borderRadius: 999,
            background: ramp.orange[400],
            flex: `0 0 ${6 * unit * typeScale}px`,
          }}
        />
      ) : (
        <StepBadge n={step} size={56 * unit * typeScale} />
      )}
      <div
        style={{
          fontFamily: font.body,
          fontWeight: 600,
          fontSize: 34 * unit * typeScale,
          lineHeight: 1.3,
          color: semantic.textStrong,
        }}
      >
        {text}
      </div>
    </div>
  );
};
