import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Plain ESM JS, deliberately not TypeScript: CI runs it with bare `node`, no build step.
import { checkExport } from '../scripts/check-bundle.mjs';

/**
 * The packaging guard's own tests.
 *
 * Fixtures rather than a real `expo export`: exporting takes about a minute and would make the
 * logic suite unusable as a fast check. What matters here is that the guard says NO to the
 * bundle that shipped on 2026-07-29 — a check that cannot fail is worse than no check, because
 * it reads as coverage.
 */

const API_URL = 'https://calendar.ngqv0712.workers.dev';

let dir: string;

/** Build an export tree whose android bundle contains `contents`. */
function fakeExport(contents: string, opts: { metadata?: boolean; name?: string } = {}) {
  const jsDir = join(dir, '_expo', 'static', 'js', 'android');
  mkdirSync(jsDir, { recursive: true });
  writeFileSync(join(jsDir, opts.name ?? 'entry-abc123.hbc'), contents, 'latin1');
  if (opts.metadata !== false) {
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ version: 0 }), 'utf8');
  }
  return dir;
}

/** Bulk, so a fixture clears the "that is not a real app bundle" size floor. */
const padded = (s: string) => s + 'x'.repeat(150_000);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mochi-bundle-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('checkExport', () => {
  it('passes a bundle that carries the API base URL', () => {
    const res = checkExport(fakeExport(padded(`const BASE="${API_URL}";`)), API_URL);
    expect(res).toMatchObject({ ok: true, errors: [] });
    expect(res.bundle).toContain('entry-abc123.hbc');
  });

  it('FAILS the bundle that shipped without EXPO_PUBLIC_API_URL', () => {
    // The 2026-07-29 shape: the variable inlined as undefined, so the origin is simply absent.
    const res = checkExport(fakeExport(padded('const BASE=undefined;')), API_URL);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('does not contain the API base URL');
  });

  it('refuses to pass judgement when no expected URL is supplied', () => {
    // Silently passing here is the trap: a check with nothing to compare would go green forever.
    const res = checkExport(fakeExport(padded(`const BASE="${API_URL}";`)), undefined);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('no expected API URL given');
  });

  it('fails an export directory that does not exist', () => {
    const res = checkExport(join(dir, 'nope'), API_URL);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('export directory not found');
  });

  it('fails when the export produced no android bundle', () => {
    mkdirSync(join(dir, '_expo', 'static', 'js', 'android'), { recursive: true });
    const res = checkExport(dir, API_URL);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('no android bundle');
  });

  it('notices a truncated bundle even when the URL is present', () => {
    const res = checkExport(fakeExport(`const BASE="${API_URL}";`), API_URL);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('not a real app bundle');
  });

  it('notices a half-finished export with no metadata.json', () => {
    const res = checkExport(fakeExport(padded(`"${API_URL}"`), { metadata: false }), API_URL);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('metadata.json is missing');
  });
});
