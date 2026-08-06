#!/usr/bin/env node
/**
 * One-time (but idempotent) provisioning of the calendar-test e2e environment:
 *
 *   1. create the mochi-class-test D1 database (if missing) and patch its
 *      database_id into wrangler.jsonc's env.test block
 *   2. create the mochi-files-test R2 bucket (if missing)
 *   3. build and deploy the `calendar-test` Worker (wrangler --env test)
 *   4. apply migrations, then seed via scripts/test-env-reset.mjs
 *
 * Requires the wrangler OAuth token to belong to ngqv0712@gmail.com.
 * Safe to re-run any time — e.g. to redeploy current code to the test env
 * (or just use `npm run test:env:deploy` for that).
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { assertNgqvAccount, resetTestDb } from './test-env-reset.mjs';

const DB_NAME = 'mochi-class-test';
const BUCKET = 'mochi-files-test';
const PLACEHOLDER = 'TEST_DB_ID_PENDING';

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function capture(cmd) {
  return execSync(cmd, { encoding: 'utf8' });
}

assertNgqvAccount();

// -- 1. D1 database ----------------------------------------------------------
const listDbs = () => JSON.parse(capture('npx wrangler d1 list --json'));
let db = listDbs().find((d) => d.name === DB_NAME);
if (!db) {
  run(`npx wrangler d1 create ${DB_NAME}`);
  db = listDbs().find((d) => d.name === DB_NAME);
  if (!db) throw new Error(`created ${DB_NAME} but cannot find it in d1 list`);
}
const dbId = db.uuid ?? db.database_id;
console.log(`${DB_NAME}: ${dbId}`);

const configPath = new URL('../wrangler.jsonc', import.meta.url);
const config = readFileSync(configPath, 'utf8');
if (config.includes(PLACEHOLDER)) {
  writeFileSync(configPath, config.replaceAll(PLACEHOLDER, dbId));
  console.log('wrangler.jsonc: patched env.test database_id');
} else if (!config.includes(dbId)) {
  throw new Error(
    `wrangler.jsonc env.test has a database_id that matches neither ${PLACEHOLDER} nor ${dbId} — fix it by hand`,
  );
}

// -- 2. R2 bucket -------------------------------------------------------------
const buckets = capture('npx wrangler r2 bucket list');
if (buckets.includes(BUCKET)) {
  console.log(`${BUCKET}: already exists`);
} else {
  run(`npx wrangler r2 bucket create ${BUCKET}`);
}

// -- 3. Build + deploy --------------------------------------------------------
// The Cloudflare vite plugin resolves the wrangler environment at BUILD time
// (it emits a flattened build/server/wrangler.json that `wrangler deploy` is
// redirected to) — so the env is chosen via CLOUDFLARE_ENV here, NOT via
// `wrangler deploy --env test`, which would silently deploy production config.
process.env.CLOUDFLARE_ENV = 'test';
run('npm run build');
run('npx wrangler deploy');

// -- 4. Migrate + seed --------------------------------------------------------
// --config bypasses the build/server/wrangler.json redirect, whose flattened
// config has no `test` environment.
run(`npx wrangler d1 migrations apply ${DB_NAME} --remote --env test --config wrangler.jsonc`);
resetTestDb();

console.log('\ncalendar-test is live: https://calendar-test.ngqv0712.workers.dev');
console.log('Logins: dev@mochi.edu / mochi123 (staff), vunq@mochi.edu / mochi123 (student)');
