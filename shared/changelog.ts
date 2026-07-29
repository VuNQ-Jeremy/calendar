/**
 * Parser for CHANGELOG.md, so the app can show its own release notes.
 *
 * Pure and dependency-free (no fs) on purpose: vite.config.ts reads the file and calls this
 * at build time to inject `__CHANGELOG__`, and tests call it on fixture strings. Same split
 * as shared/version.ts — the maths lives here, the git/fs access lives in the caller.
 *
 * The format is whatever scripts/changelog.mjs writes, currently:
 *
 *   ## v0.0046 — 2026-07-29
 *   One or two lines of prose.
 */

export type ChangelogEntry = {
  /** e.g. "v0.0046" */
  version: string;
  /** ISO date, e.g. "2026-07-29" */
  date: string;
  /** Free prose, may span lines. English only — release notes are not translated. */
  body: string;
};

/** `## v0.0046 — 2026-07-29`. The separator is an em dash (U+2014), not a hyphen. */
const HEADING = /^## (v\d+\.\d+) — (\d{4}-\d{2}-\d{2})\s*$/;

/**
 * Split a changelog into entries, in file order (newest first). Lines before the first
 * `## v…` heading are the file's preamble and are ignored.
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const line of md.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) {
      current = { version: m[1], date: m[2], body: '' };
      entries.push(current);
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    }
  }
  for (const e of entries) e.body = e.body.trim();
  return entries;
}
