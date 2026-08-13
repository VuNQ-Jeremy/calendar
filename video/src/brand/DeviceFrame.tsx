import React from 'react';
import { font } from './fonts';
import { ramp, radius, semantic, shadowCss } from './theme';

/**
 * Cream browser chrome around the footage, so a screen recording reads as "the
 * app" rather than as a raw capture. Warm neutrals only — the design system
 * forbids the pure grey a stock browser frame would bring in.
 */
export const DeviceFrame: React.FC<{
  unit: number;
  url?: string;
  children: React.ReactNode;
}> = ({ unit, url = 'calendar.ngqv0712.workers.dev', children }) => {
  const barHeight = 56 * unit;
  const dot = 14 * unit;

  return (
    <div
      style={{
        width: '100%',
        borderRadius: radius.lg * unit,
        overflow: 'hidden',
        background: semantic.surfaceRaised,
        boxShadow: shadowCss.xl,
        border: `${2 * unit}px solid ${ramp.sand[300]}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: barHeight,
          flex: `0 0 ${barHeight}px`,
          background: semantic.surfaceRaised,
          borderBottom: `${2 * unit}px solid ${ramp.sand[300]}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10 * unit,
          padding: `0 ${20 * unit}px`,
        }}
      >
        {[ramp.cocoa[300], ramp.sand[400], ramp.cocoa[100]].map((c) => (
          <div key={c} style={{ width: dot, height: dot, borderRadius: 999, background: c }} />
        ))}
        <div
          style={{
            marginLeft: 16 * unit,
            flex: 1,
            maxWidth: 520 * unit,
            height: 32 * unit,
            borderRadius: 999,
            background: semantic.bgPage,
            border: `${2 * unit}px solid ${ramp.sand[300]}`,
            display: 'flex',
            alignItems: 'center',
            padding: `0 ${16 * unit}px`,
            fontFamily: font.mono,
            fontSize: 17 * unit,
            color: semantic.textMuted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {url}
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%' }}>{children}</div>
    </div>
  );
};
