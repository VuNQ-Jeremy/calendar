// Upload the downloaded logo webp files to the FILES R2 bucket.
//
//   node scripts/upload-logos.mjs --logos <dir> [--concurrency 8] [--bucket mochi-files] [--dry-run]
//
// wrangler has no bulk R2 upload, so this drives `wrangler r2 object put` one object at a time with
// a small worker pool. Each wrangler invocation costs ~1-2s of startup, so the whole 3448-object
// library takes roughly 10-20 minutes at the default concurrency.
//
// Uploads are recorded in <dir>/.uploaded so a re-run resumes instead of re-sending everything.
// R2 PUTs are idempotent (same key, same bytes), so a duplicate upload is harmless -- the ledger
// exists to save time, not to protect correctness.
//
// This costs nothing beyond R2 storage/class-A operations; it hits no metered model API.

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`--${name} needs a value`);
  return v;
}

const logosDir = arg('logos');
const bucket = arg('bucket', 'mochi-files');
const concurrency = Number(arg('concurrency', '8'));
const dryRun = process.argv.includes('--dry-run');
if (!logosDir) {
  console.error('usage: node scripts/upload-logos.mjs --logos <dir> [--concurrency 8] [--dry-run]');
  process.exit(2);
}

const ledgerPath = join(logosDir, '.uploaded');
const done = new Set(
  existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean) : [],
);

const files = readdirSync(logosDir)
  .filter((f) => f.endsWith('.webp'))
  .filter((f) => !done.has(f));

const total = files.length;
const skipped = done.size;
console.log(
  `${total} to upload, ${skipped} already done, bucket=${bucket}, concurrency=${concurrency}`,
);
if (dryRun) {
  const bytes = files.reduce((n, f) => n + statSync(join(logosDir, f)).size, 0);
  console.log(`dry run: would upload ${total} objects, ${(bytes / 1024 / 1024).toFixed(1)}MB`);
  console.log(`first: logos/${files[0]}`);
  process.exit(0);
}

function put(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${bucket}/logos/${file}`,
        '--file',
        join(logosDir, file),
        '--content-type',
        'image/webp',
        '--remote',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], shell: process.platform === 'win32' },
    );
    let err = '';
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim() || `exit ${code}`)),
    );
    child.on('error', reject);
  });
}

let cursor = 0;
let ok = 0;
const failures = [];

async function worker() {
  while (cursor < files.length) {
    const file = files[cursor++];
    try {
      await put(file);
      appendFileSync(ledgerPath, `${file}\n`);
      ok += 1;
      if (ok % 50 === 0) console.log(`  ${ok}/${total} uploaded`);
    } catch (e) {
      failures.push({ file, error: String(e.message ?? e) });
    }
  }
}

await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

console.log(`\nuploaded ${ok}/${total}`);
if (failures.length) {
  console.error(`${failures.length} failed. First few:`);
  for (const f of failures.slice(0, 5)) console.error(`  ${f.file}: ${f.error}`);
  console.error('Re-run to retry only the failures (the ledger skips what succeeded).');
  process.exit(1);
}
