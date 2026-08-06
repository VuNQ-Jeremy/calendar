#!/usr/bin/env node
/**
 * Run the Playwright e2e suite against the calendar-test environment with
 * freshly reset seed data. Cross-platform replacement for
 * `E2E_BASE_URL=... MOCHI_EMAIL=... playwright test` (inline env vars don't
 * work in npm scripts on Windows).
 *
 * Every env var can still be overridden from outside; these are just the
 * calendar-test defaults. Pass extra Playwright args through, e.g.:
 *   npm run test:e2e:staging -- --grep "live updates"
 */

import { spawnSync } from 'node:child_process';
import { assertNgqvAccount, resetTestDb } from './test-env-reset.mjs';

process.env.E2E_BASE_URL ??= 'https://calendar-test.ngqv0712.workers.dev';
process.env.MOCHI_EMAIL ??= 'dev@mochi.edu';
process.env.MOCHI_PASSWORD ??= 'mochi123';
process.env.MOCHI_STUDENT_EMAIL ??= 'vunq@mochi.edu';
process.env.MOCHI_STUDENT_PASSWORD ??= 'mochi123';

// Fresh, deterministic data for every run — CRUD specs can assert exact state.
assertNgqvAccount();
resetTestDb();

const args = process.argv.slice(2);
console.log(`> playwright test against ${process.env.E2E_BASE_URL}`);
const result = spawnSync('npx', ['playwright', 'test', ...args], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
