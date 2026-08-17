#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Does this export actually know where the API lives?
 *
 * `expo export` succeeds whether or not EXPO_PUBLIC_API_URL was in the environment, because the
 * variable is INLINED at build time and an absent one simply inlines as `undefined`. On
 * 2026-07-29 an `eas update` published without it: `extra.apiUrl` arrived as `{}`, `{}.replace`
 * threw BEFORE THE FIRST FRAME, and expo-updates' error recovery silently rolled back to the
 * previous bundle — so the update looked like it had never shipped, and it took an hour of
 * logcat to find. `lib/api.ts` now guards the crash, but a guarded app that boots with BASE=''
 * still cannot reach the server: every screen fails.
 *
 * Nothing in `expo export` checks this, so this script does. The API origin survives into the
 * Hermes bytecode as a plain string in its string table, which makes it greppable.
 *
 * Usage: node scripts/check-bundle.mjs <export-dir> [expected-url]
 * The expected URL defaults to EXPO_PUBLIC_API_URL — the same variable the export itself read.
 *
 * EXPORT WITH `--clear`, ALWAYS. Metro caches the transformed module that the EXPO_PUBLIC_*
 * value was inlined into, so a re-export with a different (or missing) variable happily reuses
 * the previous bundle: verified 2026-08-17, where two exports with deliberately different
 * EXPO_PUBLIC_API_URL values produced byte-identical output. Checking a cached bundle would
 * pass on a URL the current environment never supplied — the exact false negative this script
 * exists to prevent. `npm run test:bundle` passes `--clear` for that reason.
 */

/** Every `.hbc`/`.js` bundle under an export's android output directory. */
function androidBundles(dir) {
  const jsDir = join(dir, '_expo', 'static', 'js', 'android');
  if (!existsSync(jsDir)) return [];
  return readdirSync(jsDir)
    .filter((f) => f.endsWith('.hbc') || f.endsWith('.js'))
    .map((f) => join(jsDir, f));
}

/**
 * @param {string} dir       an `expo export --output-dir` directory
 * @param {string|undefined} expectedUrl the API origin the bundle must contain
 * @returns {{ ok: boolean, errors: string[], bundle: string|null }}
 */
export function checkExport(dir, expectedUrl) {
  const errors = [];

  if (!existsSync(dir))
    return { ok: false, errors: [`export directory not found: ${dir}`], bundle: null };

  const metadataPath = join(dir, 'metadata.json');
  if (!existsSync(metadataPath))
    errors.push('metadata.json is missing — the export did not finish');

  const bundles = androidBundles(dir);
  if (bundles.length === 0) {
    errors.push('no android bundle under _expo/static/js/android');
    return { ok: false, errors, bundle: null };
  }
  if (bundles.length > 1) {
    errors.push(`expected exactly one android bundle, found ${bundles.length}`);
  }

  const bundle = bundles[0];
  // latin1, not utf8: Hermes bytecode is binary, and utf8 decoding mangles bytes around the
  // string table. Every URL we look for is ASCII, so latin1 round-trips them exactly.
  const source = readFileSync(bundle, 'latin1');

  if (source.length < 100_000) {
    errors.push(`bundle is only ${source.length} bytes — that is not a real app bundle`);
  }

  if (!expectedUrl) {
    errors.push(
      'no expected API URL given: pass one as the second argument or set EXPO_PUBLIC_API_URL. ' +
        'Without it this check cannot tell a configured bundle from the one that shipped blank.',
    );
  } else if (!source.includes(expectedUrl)) {
    errors.push(
      `bundle does not contain the API base URL ${expectedUrl}. EXPO_PUBLIC_API_URL was almost ` +
        'certainly missing when it was built, so the app would boot with no server to talk to ' +
        '(see the 2026-07-29 note above). Re-export with the variable set — for eas update that ' +
        'means --environment preview.',
    );
  }

  return { ok: errors.length === 0, errors, bundle };
}

// CLI. Skipped when imported by the tests.
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('check-bundle.mjs')
) {
  const dir = process.argv[2] ?? '.expo/export-check';
  const expected = process.argv[3] ?? process.env.EXPO_PUBLIC_API_URL;
  const { ok, errors, bundle } = checkExport(dir, expected);

  if (!ok) {
    console.error(`✗ bundle check failed for ${dir}`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.error(`✓ ${bundle} carries ${expected}`);
}
