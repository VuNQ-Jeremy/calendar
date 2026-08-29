import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain .mjs script module, no types; exercised here for its behaviour only.
import { BUCKETS, LEXICON, classify, parseKey } from '../scripts/logo-taxonomy.mjs';

const seedPath = resolve(__dirname, '../scripts/logo-library-seed.sql');
const seed = readFileSync(seedPath, 'utf8');

/** Every generated VALUES row, parsed back out of the seed SQL. */
const rows = [
  ...seed.matchAll(/^ {2}\('([^']+)','([^']+)','([^']+)','([^']+)','([^']+)',(\d+),/gm),
].map((m) => ({
  id: m[1],
  storageKey: m[2],
  slug: m[3],
  category: m[4],
  subject: m[5],
  variant: Number(m[6]),
}));

describe('parseKey', () => {
  it('splits hash, slug and variant', () => {
    expect(parseKey('2239f6fd9bdc1643-whale-4.png')).toEqual({
      hash: '2239f6fd9bdc1643',
      slug: 'whale',
      variant: 4,
    });
  });

  it('defaults the variant to 1 when the filename carries no number', () => {
    expect(parseKey('002239a44ae3e7dd-trombone.png')).toEqual({
      hash: '002239a44ae3e7dd',
      slug: 'trombone',
      variant: 1,
    });
  });

  it('keeps a multi-word slug intact', () => {
    expect(parseKey('00520f2f32b9e60d-deer-alert-round-eyes-left.png').slug).toBe(
      'deer-alert-round-eyes-left',
    );
  });

  it('rejects a key that is not <hash>-<slug>.png', () => {
    expect(() => parseKey('whale.png')).toThrow(/Unexpected key/);
  });
});

describe('classify', () => {
  it('takes the LAST lexicon hit, so a breed prefix does not win over the animal', () => {
    // 'nebelung' and 'cat' are both known; the corpus puts the head noun last.
    expect(classify('nebelung-cat')).toEqual({ level1: 'mammal', level2: 'cat' });
    expect(classify('french-bulldog-dog')).toEqual({ level1: 'mammal', level2: 'dog' });
    expect(classify('smooth-cheek-raccoon')).toEqual({ level1: 'mammal', level2: 'raccoon' });
  });

  it('strips trailing pose and expression modifiers', () => {
    expect(classify('fox-low-face-left')).toEqual({ level1: 'mammal', level2: 'fox' });
    expect(classify('deer-alert-round-eyes-left')).toEqual({ level1: 'mammal', level2: 'deer' });
    expect(classify('rhinoceros-shy-peek').level2).toBe('rhinoceros');
  });

  it('routes compound objects to the head noun, not the material', () => {
    expect(classify('rice-cooker-bot')).toEqual({ level1: 'tech-robot', level2: 'bot' });
    expect(classify('moka-pot')).toEqual({ level1: 'household-object', level2: 'pot' });
  });

  it('lets an exact-slug override beat token matching', () => {
    // 'watch' alone is a household object; the override keeps the full name as the subject.
    expect(classify('pocket-watch')).toEqual({
      level1: 'household-object',
      level2: 'pocket-watch',
    });
    // 'devil' is not a mammal token -- only the override makes this right.
    expect(classify('tasmanian-devil')).toEqual({ level1: 'mammal', level2: 'tasmanian-devil' });
    expect(classify('thorny-devil').level1).toBe('reptile-amphibian');
  });

  it('is deterministic', () => {
    for (const slug of ['whale', 'nebelung-cat', 'moka-pot-3', 'aye-aye']) {
      expect(classify(slug)).toEqual(classify(slug));
    }
  });

  it('only ever emits a declared bucket', () => {
    for (const [, bucket] of LEXICON) expect(BUCKETS).toContain(bucket);
  });
});

describe('logo-library-seed.sql', () => {
  it('carries the whole corpus', () => {
    expect(rows.length).toBe(3448);
  });

  it('classifies every row into a declared bucket -- nothing lands in "other"', () => {
    const bad = rows.filter((r) => !BUCKETS.includes(r.category));
    expect(bad).toEqual([]);
  });

  it('has unique ids and storage keys', () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.storageKey)).size).toBe(rows.length);
  });

  it('stores the webp preview under the logos/ prefix', () => {
    for (const r of rows.slice(0, 50)) {
      expect(r.storageKey).toMatch(/^logos\/[0-9a-f]{16}-.+\.webp$/);
    }
  });

  it('agrees with the classifier it was generated from', () => {
    for (const r of rows) {
      const { level1, level2 } = classify(r.slug);
      expect({ category: level1, subject: level2 }).toEqual({
        category: r.category,
        subject: r.subject,
      });
    }
  });

  it('clears the table before inserting, so re-applying is idempotent', () => {
    expect(seed).toContain('DELETE FROM logo_library;');
  });
});
