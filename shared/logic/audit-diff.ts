/**
 * Pure before/after diff for the activity log's detail view (src/screens-activity.tsx). No
 * dependency — this repo has no diff/JSON-viewer library, and one row's worth of key comparison
 * does not need one.
 */

export type DiffRow = {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
};

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * The union of every key present on either side, sorted, each flagged `changed` by a deep-equal
 * comparison. `before`/`after` that are not plain objects (null, a create/delete row's missing
 * side) are treated as `{}` — every key on the other side then shows as fully added or fully
 * removed, which is the honest reading.
 *
 * Does NOT special-case the `{__truncated: true, keys: [...]}` stub `snapshotJson` falls back to
 * over the 8 KB cap — it has no field values to diff, so the caller (src/screens-activity.tsx)
 * checks for it and renders a "snapshot truncated" note instead of calling this at all.
 */
export function diffKeys(before: unknown, after: unknown): DiffRow[] {
  const isPlain = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const b = isPlain(before) ? before : {};
  const a = isPlain(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  return keys.map((key) => ({
    key,
    before: b[key],
    after: a[key],
    changed: !deepEqual(b[key], a[key]),
  }));
}
