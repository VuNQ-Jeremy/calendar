import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vite';
import { dataLocPlugin } from './vite-plugin-data-loc';
import { gitBuild, gitSha } from './scripts/git-version.mjs';
import { formatVersion, resolveBuild } from './shared/version';

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
  },
});
