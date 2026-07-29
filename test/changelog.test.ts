import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseChangelog } from '../shared/changelog';

describe('parseChangelog', () => {
  it('skips the preamble and reads entries in file order', () => {
    const entries = parseChangelog(
      [
        '# Changelog',
        '',
        'One entry per push to `main`. Newest first.',
        '',
        '## v0.0046 — 2026-07-29',
        'Newest thing.',
        '',
        '## v0.0043 — 2026-07-28',
        'Older thing.',
        '',
      ].join('\n'),
    );
    expect(entries).toEqual([
      { version: 'v0.0046', date: '2026-07-29', body: 'Newest thing.' },
      { version: 'v0.0043', date: '2026-07-28', body: 'Older thing.' },
    ]);
  });

  it('keeps multi-line bodies and trims surrounding blank lines', () => {
    const [entry] = parseChangelog('## v0.0001 — 2026-01-01\n\nFirst line.\nSecond line.\n\n');
    expect(entry.body).toBe('First line.\nSecond line.');
  });

  it('parses a CRLF checkout', () => {
    const entries = parseChangelog('## v0.0001 — 2026-01-01\r\nA thing.\r\n');
    expect(entries).toEqual([{ version: 'v0.0001', date: '2026-01-01', body: 'A thing.' }]);
  });

  it('ignores headings that are not the changelog format', () => {
    // A hyphen or en dash instead of the em dash scripts/changelog.mjs writes, and
    // any other heading level, must not be mistaken for an entry.
    const md = ['## v0.0001 - 2026-01-01', 'hyphen', '## v0.0002 – 2026-01-02', 'en dash'].join(
      '\n',
    );
    expect(parseChangelog(md)).toEqual([]);
  });

  it('returns nothing for a changelog with no entries', () => {
    expect(parseChangelog('# Changelog\n\nNothing yet.\n')).toEqual([]);
  });

  // Guards the real file: vite.config.ts throws the build if this ever parses to zero,
  // so failing here first tells you the format drifted before a deploy does.
  it('parses the repository CHANGELOG.md', () => {
    // cwd, not import.meta.url: under jsdom that URL is http:, not file:.
    const md = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const entries = parseChangelog(md);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].version).toMatch(/^v\d+\.\d{4}$/);
    expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entries.every((e) => e.body.length > 0)).toBe(true);
  });
});
