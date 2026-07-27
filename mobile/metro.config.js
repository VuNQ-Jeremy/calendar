/**
 * The mobile app imports `shared/` — the same Zod schemas, string dictionary and design tokens
 * the web app uses. One source of truth, never a copy.
 *
 * **`shared/` is reached as an npm dependency, not a Metro watch folder.** `mobile/package.json`
 * declares `"@mochi/shared": "file:../shared"`, so npm symlinks it into `mobile/node_modules`
 * and Metro resolves it like any other package. This is deliberate and load-bearing:
 * `watchFolders` does NOT work for a sibling directory here. Expo's forked Metro file map is
 * constructed with `rootDir: projectRoot` and silently ignores any root outside it
 * (`@expo/cli/.../createFileMap-fork.js`), so `../shared` never enters the file map and every
 * import of it fails to resolve — including plain relative ones. Setting
 * `server.unstable_serverRoot` to the repo root fixes resolution but then breaks the entry
 * point. The dependency route sidesteps all of it. Do not "simplify" this back to watchFolders.
 *
 * `watchFolders` is still listed below so that EDITING a file in shared/ triggers a reload
 * during `expo start`; resolution does not depend on it.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '..', 'shared');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];

/**
 * Resolve every dependency from `mobile/node_modules` only.
 *
 * Without this, `shared/schemas.ts` — whose real path is outside the project — would resolve
 * its `zod` import by walking up from `F:/code/calendar/shared` and find the WEB app's copy in
 * the repo root's node_modules. That root holds react-router, vite and drizzle too; none of it
 * may ever leak into a native bundle.
 */
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
