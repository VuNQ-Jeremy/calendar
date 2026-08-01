#!/usr/bin/env node
/**
 * Find i18n keys that are referenced but never defined, and en keys with no vi translation.
 *
 *   npm run check:i18n
 *
 * Deliberately NOT wired into `lint` or CI — the `satisfies` clause on STRINGS already catches
 * en/vi drift at compile time, and this script's other half (referenced-but-undefined) needs a
 * human to read the allowlist. Run it by hand when touching strings.
 *
 * Exits 1 when something is missing, 0 when clean.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRINGS_FILE = join(root, 'shared', 'i18n', 'strings.ts');

/** Roots walked for t() call sites. */
const SCAN_DIRS = ['src', 'app', 'mobile', 'shared'];

/** Never walked — build output, native projects, vendored code. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.expo',
  '.react-router',
  'android',
  'ios',
  'dist',
  'build',
  'test-results',
  '.git',
]);

/**
 * Prefixes composed at runtime — `t('role_' + role)`. A static scan sees the prefix and calls it
 * undefined; it isn't. Add to this list rather than silencing a whole file.
 */
const DYNAMIC_PREFIXES = ['role_', 'rel_'];

const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

// ---------------------------------------------------------------- key sets

/**
 * Pull the en and vi key sets straight out of the source. Parsing beats importing: this file is
 * a .ts module with path aliases, and the shape here is flat `key: 'value',` lines, so a regex
 * over the two blocks is both simpler and dependency-free.
 */
function readKeySets() {
  const src = readFileSync(STRINGS_FILE, 'utf8');
  const enStart = src.indexOf('const en_strings = {');
  const enEnd = src.indexOf('\n} as const;', enStart);
  const viStart = src.indexOf('vi: {', enEnd);
  const viEnd = src.indexOf('\n} satisfies', viStart);
  if (enStart === -1 || enEnd === -1 || viStart === -1 || viEnd === -1) {
    console.error(`check-i18n: could not locate the en/vi blocks in ${STRINGS_FILE}`);
    process.exit(1);
  }
  const keysIn = (text) => {
    const out = new Set();
    for (const m of text.matchAll(/^\s{2,4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) out.add(m[1]);
    return out;
  };
  return {
    en: keysIn(src.slice(enStart, enEnd)),
    vi: keysIn(src.slice(viStart, viEnd)),
  };
}

// ---------------------------------------------------------------- call sites

/**
 * The repo carries ~180 compiled .js files sitting beside their .ts source. Scanning both
 * double-reports every key and, worse, reports keys from stale builds. Source wins.
 */
function hasTsSibling(file) {
  const ext = extname(file);
  if (ext !== '.js' && ext !== '.jsx') return false;
  const base = file.slice(0, -ext.length);
  return existsSync(`${base}.ts`) || existsSync(`${base}.tsx`);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXT.has(extname(entry)) && !hasTsSibling(full)) out.push(full);
  }
  return out;
}

/** t('key') / t("key") / t(`key`) — literal first argument only. */
const T_CALL = /\bt\(\s*(['"`])([A-Za-z_][A-Za-z0-9_]*)\1/g;

function collectRefs() {
  const refs = new Map(); // key -> Set<file:line>
  for (const dir of SCAN_DIRS) {
    const full = join(root, dir);
    if (!existsSync(full)) continue;
    for (const file of walk(full)) {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(T_CALL)) {
          const rel = file.slice(root.length + 1).replace(/\\/g, '/');
          if (!refs.has(m[2])) refs.set(m[2], new Set());
          refs.get(m[2]).add(`${rel}:${i + 1}`);
        }
      });
    }
  }
  return refs;
}

// ---------------------------------------------------------------- report

const { en, vi } = readKeySets();
const refs = collectRefs();

const undefinedKeys = [...refs.keys()]
  .filter((k) => !en.has(k))
  .filter((k) => !DYNAMIC_PREFIXES.some((p) => k === p.slice(0, -1) || k.startsWith(p)))
  .sort();

const missingVi = [...en].filter((k) => !vi.has(k)).sort();
const unused = [...en].filter((k) => !refs.has(k)).sort();

console.log(`check-i18n: ${en.size} en keys, ${vi.size} vi keys, ${refs.size} referenced`);

if (undefinedKeys.length) {
  console.log(`\nReferenced but undefined (${undefinedKeys.length}):`);
  for (const k of undefinedKeys) {
    console.log(`  ${k}`);
    for (const site of refs.get(k)) console.log(`      ${site}`);
  }
}

if (missingVi.length) {
  console.log(`\nDefined in en but missing from vi (${missingVi.length}):`);
  for (const k of missingVi) console.log(`  ${k}`);
}

// Informational only. Many of these are dynamic-prefix targets (type_*, cat_*, bh_*, att_*,
// cfg_sb_*, cfg_tb_*) or reached through a variable — mobile's login does
// `setError('auth_wrong_creds')` then `t(error)`, which no static scan can see. Never prune from
// this list without checking each key by hand.
if (process.argv.includes('--unused') && unused.length) {
  console.log(`\nDefined but never statically referenced (${unused.length}) — informational:`);
  for (const k of unused) console.log(`  ${k}`);
}

if (undefinedKeys.length || missingVi.length) {
  console.log('\ncheck-i18n: FAIL');
  process.exit(1);
}
console.log(`check-i18n: OK (${unused.length} unused keys; re-run with --unused to list them)`);
