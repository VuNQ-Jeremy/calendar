/**
 * Reads shared/version.json for Node-evaluated configs (mobile/app.config.ts).
 *
 * A file read rather than `import stored from '../shared/version.json'`, because that import
 * works on some Node/loader combinations and not others. It works on a dev machine; it does NOT
 * work on the EAS build worker, which loads app.config.ts through `@expo/require-utils` into an
 * ESM context where Node rejects a JSON import that has no `with { type: 'json' }` attribute.
 * A preview build failed there, in the "Read app config" phase, with ERR_IMPORT_ATTRIBUTE_MISSING.
 *
 * The attribute syntax would fix it on current Node but is itself newer syntax that a transform
 * may drop before Node sees it. Reading the bytes works everywhere, forever.
 *
 * This lives in a .mjs alongside git-version.mjs — the other Node-only helper app.config.ts
 * imports — so that the mobile TypeScript project does not need `@types/node` just to read three
 * integers.
 *
 * Bundled code must NOT use this: the browser and React Native go through shared/version.ts,
 * where the bundler handles the JSON import.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `{ major, buildOffset, runtimeVersion }` from shared/version.json. */
export function storedVersion() {
  // Resolved from THIS module's own URL, not cwd: app.config.ts is evaluated with different
  // working directories by `expo config`, `eas build` and the EAS worker.
  const file = fileURLToPath(new URL('../shared/version.json', import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8'));
}
