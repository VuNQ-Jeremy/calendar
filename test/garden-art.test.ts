import { describe, it, expect } from 'vitest';
import {
  LOCKED_PALETTE,
  SPECIES,
  newlyUnlocked,
  nextUnlock,
  speciesOf,
  unlockedSpecies,
} from '../shared/garden-art';

/**
 * The registry's contract, not its artwork. What the drawings look like is checked by eye through
 * scripts/render-plants.mjs; what is checked here is everything a wrong answer would silently
 * break — the unlock ladder, the classic fallback, and the one invariant the server's species
 * guard leans on.
 */

describe('the species ladder', () => {
  it('starts at classic, the only species free from the start', () => {
    expect(SPECIES[0].id).toBe('classic');
    // updatePlant treats "no plant row" as "0 fruit, so only the starter is available" and
    // therefore skips the write entirely. A second free species would make that a silent bug.
    expect(SPECIES.filter((s) => s.unlockAt === 0)).toHaveLength(1);
  });

  it('climbs the agreed ramp', () => {
    expect(SPECIES.map((s) => s.unlockAt)).toEqual([0, 1, 2, 4, 6, 9, 12, 16, 20, 25]);
  });

  it('is ordered by threshold, with unique ids', () => {
    const thresholds = SPECIES.map((s) => s.unlockAt);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(SPECIES.length);
  });
});

describe('speciesOf', () => {
  it('finds a known species', () => {
    expect(speciesOf('mai').unlockAt).toBe(25);
  });

  it('falls back to classic rather than nothing', () => {
    // A pre-species album, a newer deployment's id, a typo: all three must still draw a plant.
    expect(speciesOf('khong-co').id).toBe('classic');
    expect(speciesOf(null).id).toBe('classic');
    expect(speciesOf(undefined).id).toBe('classic');
  });
});

describe('unlock helpers', () => {
  it('opens the starter to a student who has never harvested', () => {
    expect(unlockedSpecies(0).map((s) => s.id)).toEqual(['classic']);
    expect(nextUnlock(0)?.unlockAt).toBe(1);
  });

  it('opens everything to a student at the top of the ladder', () => {
    expect(unlockedSpecies(25)).toHaveLength(SPECIES.length);
    expect(nextUnlock(25)).toBeNull();
    expect(nextUnlock(99)).toBeNull();
  });

  it('treats a threshold as reached, not passed', () => {
    expect(unlockedSpecies(1).map((s) => s.id)).toEqual(['classic', 'cachua']);
    expect(nextUnlock(1)?.unlockAt).toBe(2);
  });

  it('reports only what a harvest just opened', () => {
    expect(newlyUnlocked(0, 1).map((s) => s.id)).toEqual(['cachua']);
    expect(newlyUnlocked(1, 1)).toHaveLength(0);
    // A jump (a dev tool, a backfill) reports every threshold it crossed, not just the last.
    expect(newlyUnlocked(3, 6).map((s) => s.unlockAt)).toEqual([4, 6]);
    expect(newlyUnlocked(25, 30)).toHaveLength(0);
  });
});

describe('every species can be drawn', () => {
  it('has all five stages, none of them empty', () => {
    for (const s of SPECIES) {
      for (const stage of [1, 2, 3, 4, 5] as const) {
        expect(s.stages[stage].length, `${s.id} stage ${stage}`).toBeGreaterThan(0);
      }
    }
  });

  it('paints in literal hex, never a CSS variable', () => {
    // The share card is rasterized from a detached clone, where var(--x) resolves to nothing.
    for (const s of SPECIES) {
      for (const [role, value] of Object.entries(s.palette)) {
        if (role === 'gloss') continue;
        expect(String(value), `${s.id}.${role}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('has a locked palette that hides every colour', () => {
    const hues = new Set(
      Object.entries(LOCKED_PALETTE)
        .filter(([role]) => role !== 'gloss' && role !== 'white')
        .map(([, v]) => v),
    );
    expect(hues.size).toBeLessThanOrEqual(2); // one fill, one ink — a silhouette, not a preview
    expect(LOCKED_PALETTE.gloss).toBe(0);
  });
});
