import React from 'react';
import { ramp, radius, shadowCss } from './theme';

/**
 * Mochi's brand mark: the Lucide `paw` glyph in a rounded orange tile.
 *
 * The path data is copied verbatim from src/icons.tsx:62 so the mark in a video
 * is the same mark as in the app.
 */
const PAW_PATHS = {
  circles: [
    { cx: 11, cy: 4, r: 2 },
    { cx: 18, cy: 8, r: 2 },
    { cx: 20, cy: 16, r: 2 },
  ],
  pad: 'M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10z',
};

export const PawGlyph: React.FC<{
  size: number;
  color?: string;
  /** 0 → unstroked, 1 → fully drawn. Circles fade in over the same range. */
  draw?: number;
}> = ({ size, color = '#FFFFFF', draw = 1 }) => {
  // Rough path lengths at the 24×24 viewBox scale; exact values only affect the
  // feel of the draw-on, and these were measured to look even.
  const padLen = 46;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={PAW_PATHS.pad}
        strokeDasharray={padLen}
        strokeDashoffset={padLen * (1 - Math.min(1, draw / 0.7))}
      />
      {PAW_PATHS.circles.map((c, i) => {
        // Toes pop in one after another across the back half of the draw.
        const start = 0.45 + i * 0.15;
        const t = Math.max(0, Math.min(1, (draw - start) / 0.2));
        return (
          <circle
            key={c.cx}
            cx={c.cx}
            cy={c.cy}
            r={c.r * t}
            opacity={t}
          />
        );
      })}
    </svg>
  );
};

/** The paw glyph inside its orange tile — the full lockup mark. */
export const PawLogo: React.FC<{
  size: number;
  draw?: number;
  shadow?: boolean;
}> = ({ size, draw = 1, shadow = true }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: (radius.xl / 96) * size,
      background: ramp.orange[400],
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: shadow ? shadowCss.md : undefined,
    }}
  >
    <PawGlyph size={size * 0.58} draw={draw} />
  </div>
);
