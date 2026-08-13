import React from 'react';
import { Audio, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

/**
 * Background music, faded in and out so a hard cut never clips the waveform.
 *
 * `public/music/*.mp3` is gitignored — drop a freely licensed track (Pixabay
 * Music, YouTube Audio Library) in there and name it in the catalog entry. When
 * no file is named the videos are silent, which is a valid state, not a bug.
 */
export const Soundtrack: React.FC<{ src?: string; volume?: number }> = ({ src, volume = 0.22 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  if (!src) return null;

  const gain =
    interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) *
    interpolate(frame, [durationInFrames - 35, durationInFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

  return <Audio src={staticFile(`music/${src}`)} loop volume={gain * volume} />;
};
