import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ramp, semantic, status, categoryColor } from '../shared/tokens';
import { PALETTE } from '../src/lib/core';

/**
 * shared/tokens.ts is a hand-maintained mirror of colors.css (React Native cannot read CSS
 * custom properties). These tests fail the moment the two drift.
 */

// vitest runs from the repo root; import.meta.url is not a file URL under jsdom.
const css = readFileSync(join(process.cwd(), 'src/ds/styles/tokens/colors.css'), 'utf8');

/** Read a `--name: #HEX;` declaration out of colors.css. */
function cssVar(name: string): string | undefined {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`));
  return m?.[1];
}

describe('shared/tokens.ts mirrors colors.css', () => {
  it('every raw ramp value matches the CSS', () => {
    const mismatches: string[] = [];
    for (const [family, shades] of Object.entries(ramp)) {
      for (const [shade, hex] of Object.entries(shades)) {
        const fromCss = cssVar(`${family}-${shade}`);
        if (fromCss === undefined) mismatches.push(`--${family}-${shade} missing from colors.css`);
        else if (fromCss.toUpperCase() !== hex.toUpperCase())
          mismatches.push(`--${family}-${shade}: css=${fromCss} tokens=${hex}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('status colors match the CSS', () => {
    for (const [name, hex] of Object.entries(status)) {
      expect(cssVar(name)?.toUpperCase()).toBe(hex.toUpperCase());
    }
  });

  it('semantic aliases resolve to the same ramp values the CSS points at', () => {
    // Spot-check the aliases most likely to be edited.
    expect(semantic.bgPage).toBe(ramp.cream[50]);
    expect(semantic.textStrong).toBe(ramp.ink[900]);
    expect(semantic.brand).toBe(ramp.orange[400]);
    expect(semantic.borderSubtle).toBe(ramp.sand[300]);
    expect(semantic.surfaceCard).toBe('#FFFFFF');
  });

  it('category colors match PALETTE in src/lib/core.ts', () => {
    // PALETTE is what the web actually renders; ColorId values are stored in the database,
    // so the two must agree on all six.
    for (const entry of PALETTE) {
      const token = categoryColor[entry.id as keyof typeof categoryColor];
      expect(token, `missing category color: ${entry.id}`).toBeDefined();
      expect(token.base.toUpperCase(), `${entry.id}.base`).toBe(entry.hex.toUpperCase());
    }
    expect(Object.keys(categoryColor).sort()).toEqual(PALETTE.map((p) => p.id).sort());
  });
});
