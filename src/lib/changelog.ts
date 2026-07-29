import type { ChangelogEntry } from '../../shared/changelog';

/**
 * CHANGELOG.md, parsed at build time by vite `define` (see vite.config.ts). Newest first.
 *
 * Baked into the bundle rather than fetched: it is a handful of KB that changes only when
 * the code does, so it ships with the build it describes. Same mechanism as BUILD_ID.
 */
export const CHANGELOG: ChangelogEntry[] = __CHANGELOG__;
