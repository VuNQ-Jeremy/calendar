import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { PawLogo } from './PawLogo';
import { font } from './fonts';
import { ramp, semantic, ease, softSpring } from './theme';

/**
 * The bookend sting. Cream field, the paw tile springs in, the paw strokes draw
 * themselves, then the wordmark and a line of Vietnamese slide up.
 */
export const PawSting: React.FC<{
  mode: 'intro' | 'outro';
  /** Vietnamese line under the wordmark — for a guide, the video's title. */
  tagline?: string;
  /** Smaller line under the tagline. */
  subtitle?: string;
  typeScale?: number;
}> = ({ mode, tagline, subtitle, typeScale = 1 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const unit = width / 1920;

  const pop = spring({ frame, fps, config: softSpring });
  const draw = interpolate(frame, [8, 34], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease.out,
  });
  const textRise = spring({ frame: frame - 20, fps, config: softSpring });

  // Both modes fade out at the tail so they cut cleanly into / out of footage.
  const fadeOut = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeIn = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });

  const logoSize = 220 * unit * typeScale;

  return (
    <AbsoluteFill
      style={{
        background: semantic.bgPage,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 40 * unit,
        opacity: Math.min(fadeIn, fadeOut),
      }}
    >
      <div style={{ transform: `scale(${0.7 + pop * 0.3})` }}>
        <PawLogo size={logoSize} draw={draw} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12 * unit,
          transform: `translateY(${(1 - textRise) * 30 * unit}px)`,
          opacity: textRise,
        }}
      >
        <div
          style={{
            fontFamily: font.wordmark,
            fontWeight: 600,
            fontSize: 108 * unit * typeScale,
            color: semantic.textStrong,
            letterSpacing: -1 * unit,
            lineHeight: 1,
          }}
        >
          Mochi
        </div>
        {tagline ? (
          <div
            style={{
              fontFamily: font.display,
              fontWeight: 500,
              fontSize: 40 * unit * typeScale,
              color: semantic.textBody,
              textAlign: 'center',
              maxWidth: 1200 * unit,
            }}
          >
            {tagline}
          </div>
        ) : null}
        {subtitle ? (
          <div
            style={{
              fontFamily: font.body,
              fontWeight: 600,
              fontSize: 26 * unit * typeScale,
              color: semantic.textMuted,
              textAlign: 'center',
            }}
          >
            {subtitle}
          </div>
        ) : null}
        {mode === 'outro' ? (
          <div
            style={{
              marginTop: 18 * unit,
              fontFamily: font.mono,
              fontSize: 30 * unit * typeScale,
              color: ramp.orange[700],
              background: ramp.orange[50],
              border: `2px solid ${ramp.orange[200]}`,
              borderRadius: 999,
              padding: `${10 * unit}px ${26 * unit}px`,
            }}
          >
            calendar.ngqv0712.workers.dev
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
