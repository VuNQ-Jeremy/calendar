#!/usr/bin/env node
/**
 * Reset the calendar-test database to known seed data.
 *
 * Applies seed.sql (wipes + re-inserts the demo dataset) and then
 * test-accounts.sql (e2e login accounts, re-linked after the wipe) against the
 * REMOTE mochi-class-test D1 via the wrangler `test` environment. Never touches
 * production: the database name and --env are hardcoded.
 *
 * Requires the wrangler OAuth token to belong to ngqv0712@gmail.com
 * (see scripts/test-env-setup.mjs).
 */

import { execSync } from 'node:child_process';

export function assertNgqvAccount() {
  const who = execSync('npx wrangler whoami', { encoding: 'utf8' });
  if (!who.includes('76079018622e1a5f0da4ba11137f087a')) {
    console.error(
      'wrangler is not logged into the ngqv0712@gmail.com account.\n' +
        'Run `npx wrangler login` in a browser signed into ngqv0712@gmail.com, then retry.\n' +
        '(Note: this evicts the tech@entag.co token — the other project re-logins the same way.)',
    );
    process.exit(1);
  }
}

export function resetTestDb() {
  for (const file of ['./seed.sql', './scripts/test-accounts.sql']) {
    console.log(`> d1 execute mochi-class-test --file=${file}`);
    // --config bypasses the vite plugin's build/server/wrangler.json redirect,
    // whose flattened config has no `test` environment.
    execSync(
      `npx wrangler d1 execute mochi-class-test --remote --env test --config wrangler.jsonc --file=${file}`,
      { stdio: 'inherit' },
    );
  }
}

// Run directly (not imported by test-env-setup.mjs)?
if (process.argv[1] && process.argv[1].endsWith('test-env-reset.mjs')) {
  assertNgqvAccount();
  resetTestDb();
  console.log('calendar-test database reset to seed data.');
}
