import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVocabRows } from '../shared/logic/vocab-csv';
import { VOCAB_TOPICS } from '../shared/logic/vocab-topics';
import { exampleContainsAnswer } from '../shared/logic/flashcards';

/**
 * The shipped book data is a committed artefact, so it gets a test like any other code.
 *
 * It was produced by `scripts/gdoc-vocab-csv.mjs` from the Google Docs HTML export, and it is what a
 * platform admin imports to seed the shared library. This asserts it still parses, still covers the
 * six units, and — the part that actually bites — that every example sentence really contains its
 * answer, because a mismatch there is silently discarded at import and the cloze and listen games
 * lose that word with nothing to show for it.
 */
describe('en9-global-success.csv', () => {
  const text = readFileSync('data/curricula/en9-global-success.csv', 'utf8');

  /** Minimal RFC-4180 split: the file quotes any cell containing a comma. */
  function splitCsv(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  }

  const rows = text.trim().split('\n').map(splitCsv);
  const parsed = parseVocabRows(
    rows,
    VOCAB_TOPICS.map((t) => t.id),
  );

  it('is valid UTF-8 with no export damage', () => {
    expect(text).not.toContain('�');
    // A stray named entity means the extractor's decoder missed one — the failure mode that once
    // emptied the IPA and example columns for the whole book by breaking header matching.
    expect(text).not.toMatch(/&[a-z]+;|&#\d+;/i);
  });

  it('has no ragged rows', () => {
    const width = rows[0].length;
    const ragged = rows.map((r, i) => [i + 1, r.length]).filter(([, n]) => n !== width);
    expect(ragged).toEqual([]);
  });

  it('parses into the six units of the book, in order', () => {
    expect(parsed.units.map((u) => [u.unitNo, u.name])).toEqual([
      [1, 'Local community'],
      [2, 'City life'],
      [3, 'Healthy living for teens'],
      [4, 'Remembering the past'],
      [5, 'Our experiences'],
      [6, 'Vietnamese lifestyles: then and now'],
    ]);
  });

  it('was not truncated and skipped nothing', () => {
    expect(parsed.truncated).toBe(false);
    expect(parsed.skipped).toEqual([]);
  });

  it('carries enough words per unit to be worth batching', () => {
    for (const u of parsed.units) {
      expect(u.words.length, `unit ${u.unitNo}`).toBeGreaterThanOrEqual(50);
    }
    const total = parsed.units.reduce((a, u) => a + u.words.length, 0);
    expect(total).toBeGreaterThan(380);
  });

  it('gives every word a Vietnamese meaning', () => {
    const missing = parsed.units
      .flatMap((u) => u.words)
      .filter((w) => w.issues.includes('vi_issue_no_meaning'))
      .map((w) => `row ${w.row}: ${w.word}`);
    expect(missing).toEqual([]);
  });

  it('references no topic tag outside the catalog', () => {
    const bad = parsed.units
      .flatMap((u) => u.words)
      .filter((w) => w.issues.includes('vi_issue_unknown_topic'));
    expect(bad).toEqual([]);
  });

  it('keeps every surviving example sentence usable by the sentence games', () => {
    // The parser has already nulled the unusable ones; this asserts the ones it KEPT really hold up,
    // which is the invariant `blankExample` depends on.
    for (const w of parsed.units.flatMap((u) => u.words)) {
      if (!w.exampleEn) continue;
      expect(w.exampleAnswer, `row ${w.row}: ${w.word}`).toBeTruthy();
      expect(
        exampleContainsAnswer(w.exampleEn, w.exampleAnswer!),
        `row ${w.row}: "${w.exampleAnswer}" not whole-word in "${w.exampleEn}"`,
      ).toBe(true);
    }
  });

  it('carries the phrasal verbs the book teaches, from both of its two layouts', () => {
    const words = new Set(parsed.units.flatMap((u) => u.words.map((w) => w.word.toLowerCase())));
    // From the vocabulary and grammar TABLES …
    for (const w of ['look after', 'come up with', 'work out', 'cut down on']) {
      expect(words, `table phrasal verb "${w}"`).toContain(w);
    }
    // … and from unit 2's numbered PROSE LIST, which is a different shape in the same book.
    for (const w of ['get around', 'carry out']) {
      expect(words, `prose-list phrasal verb "${w}"`).toContain(w);
    }
  });

  it('labels part of speech on nearly every row', () => {
    const all = parsed.units.flatMap((u) => u.words);
    const withPos = all.filter((w) => w.partOfSpeech);
    // The prose-list phrasal verbs get `phr.v` assigned; the tables carry their own column.
    expect(withPos.length / all.length).toBeGreaterThan(0.9);
  });
});
