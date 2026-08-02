/**
 * Types for validate.mjs, which is plain dependency-free JavaScript so a teacher can run it with a
 * bare `node validate.mjs` and so it works in a chat sandbox with no node_modules. The repo's own
 * test imports it, and this is what lets `tsc --noEmit` see the shape — the same arrangement as
 * scripts/git-version.d.mts.
 */

export declare function validateCsv(text: string): {
  /** The file will not import as its author intended. Fix these. */
  errors: string[];
  /** Worth a look; a blank answer column on a paper with no key is the commonest one. */
  warnings: string[];
  /** Rows carrying a prompt — the number of questions that would import. */
  count: number;
  /** How many of those rows have a non-blank answer cell. */
  answered: number;
  /** The printed question numbers, in row order, with unnumbered rows left out. */
  numbers: number[];
};
