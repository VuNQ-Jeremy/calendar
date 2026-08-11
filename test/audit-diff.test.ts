import { describe, it, expect } from 'vitest';
import { diffKeys } from '../shared/logic/audit-diff';

describe('diffKeys', () => {
  it('flags a changed field and leaves an unchanged one alone', () => {
    const rows = diffKeys({ name: 'Old', color: 'blue' }, { name: 'New', color: 'blue' });
    expect(rows).toEqual([
      { key: 'color', before: 'blue', after: 'blue', changed: false },
      { key: 'name', before: 'Old', after: 'New', changed: true },
    ]);
  });

  it('shows an added key as before:undefined, changed', () => {
    const rows = diffKeys({ a: 1 }, { a: 1, b: 2 });
    const added = rows.find((r) => r.key === 'b');
    expect(added).toEqual({ key: 'b', before: undefined, after: 2, changed: true });
  });

  it('shows a removed key as after:undefined, changed', () => {
    const rows = diffKeys({ a: 1, b: 2 }, { a: 1 });
    const removed = rows.find((r) => r.key === 'b');
    expect(removed).toEqual({ key: 'b', before: 2, after: undefined, changed: true });
  });

  it('a create row (before=null) shows every field as fully added', () => {
    const rows = diffKeys(null, { name: 'New', color: 'blue' });
    expect(rows.every((r) => r.changed)).toBe(true);
    expect(rows.every((r) => r.before === undefined)).toBe(true);
  });

  it('a delete row (after=null) shows every field as fully removed', () => {
    const rows = diffKeys({ name: 'Gone' }, null);
    expect(rows).toEqual([{ key: 'name', before: 'Gone', after: undefined, changed: true }]);
  });

  it('both null (a meta-only event with no snapshot) has no rows', () => {
    expect(diffKeys(null, null)).toEqual([]);
  });

  it('deep-compares nested objects and arrays rather than reference-comparing them', () => {
    const rows = diffKeys(
      { classIds: ['a', 'b'], meta: { x: 1 } },
      { classIds: ['a', 'b'], meta: { x: 1 } },
    );
    expect(rows.every((r) => !r.changed)).toBe(true);

    const changed = diffKeys({ classIds: ['a', 'b'] }, { classIds: ['a', 'c'] });
    expect(changed[0].changed).toBe(true);
  });

  it('never throws, even on the __truncated stub (the UI checks for that shape itself)', () => {
    expect(() => diffKeys({ __truncated: true, keys: ['a', 'b'] }, { a: 1 })).not.toThrow();
  });
});
