import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { dataLocPlugin } from './vite-plugin-data-loc';
import { gitBuild, gitSha } from './scripts/git-version.mjs';
import { formatVersion, resolveBuild } from './shared/version';
import { parseChangelog } from './shared/changelog';

// Release notes are baked into the bundle so the app can show its own changelog.
// Parsed once at config load, so a new entry needs a dev-server restart to appear.
const changelog = parseChangelog(readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf8'));
if (changelog.length === 0) {
  throw new Error(
    'CHANGELOG.md parsed to zero entries — heading format drift? See shared/changelog.ts',
  );
}

export default defineConfig({
  plugins: [
    dataLocPlugin(),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    reactRouter(),
    tsconfigPaths(),
  ],
  define: {
    // Build number is derived from the git commit count; see scripts/git-version.mjs.
    __APP_VERSION__: JSON.stringify(formatVersion(resolveBuild(gitBuild()))),
    __GIT_SHA__: JSON.stringify(gitSha()),
    __CHANGELOG__: JSON.stringify(changelog),
  },
});
