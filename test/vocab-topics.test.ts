import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VOCAB_TOPICS } from '../shared/logic/vocab-topics';

/**
 * `vocab_topics` is seeded once, by a migration, from the TS catalog. Nothing keeps the two in step
 * at runtime, so this test is the thing that does: adding an entry to the array without a row would
 * otherwise produce a tag the UI offers and the FK rejects.
 */
describe('vocab_topics seed', () => {
  const sql = readFileSync('migrations/0046_vocab_topics.sql', 'utf8');
  /** `('food','food','Food & Cooking','Ẩm thực & Nấu ăn',1,2),` */
  const seeded = [...sql.matchAll(/^\s*\('([a-z0-9-]+)','([a-z0-9-]+)',/gm)].map((m) => ({
    id: m[1],
    slug: m[2],
  }));

  it('seeds a row for every catalog entry', () => {
    const ids = new Set(seeded.map((r) => r.id));
    for (const t of VOCAB_TOPICS) expect(ids, `missing seed row for ${t.id}`).toContain(t.id);
  });

  it('seeds no rows the catalog does not know about', () => {
    expect(seeded.map((r) => r.id).sort()).toEqual(VOCAB_TOPICS.map((t) => t.id).sort());
  });

  it('uses the catalog id as the slug, which is what keeps old references resolving', () => {
    for (const row of seeded) expect(row.slug).toBe(row.id);
  });

  it('keeps ids url-safe, since the id doubles as the slug', () => {
    for (const t of VOCAB_TOPICS) expect(t.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('has both labels on every entry', () => {
    for (const t of VOCAB_TOPICS) {
      expect(t.en.trim(), `en label for ${t.id}`).not.toBe('');
      expect(t.vi.trim(), `vi label for ${t.id}`).not.toBe('');
    }
  });

  it('seeds the English label the catalog carries, so the generator prompt is unchanged', () => {
    for (const t of VOCAB_TOPICS) {
      expect(sql, `en label for ${t.id}`).toContain(`'${t.id}','${t.id}','${t.en}'`);
    }
  });
});
