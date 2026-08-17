import { defineConfig } from 'vitest/config';

/**
 * `.claude/skills/question-csv/validate.mjs` is dual-use: a CLI a model runs as
 * `./validate.mjs foo.csv` (hence the `#!/usr/bin/env node`) AND a module
 * test/skill-validator.test.ts imports to check the skill against the app's own
 * parser. Node strips a shebang before parsing; Vite's dependency transform does
 * not, so `#` reaches the parser and the whole test file dies at import with a
 * bare `SyntaxError: Invalid or unexpected token` and no line number.
 *
 * Blanking the line here — rather than deleting it from the file — keeps the
 * skill folder shipping exactly as it executes. Replaced with `//` plus padding
 * so byte offsets, and therefore stack traces, still line up.
 */
const stripShebang = {
  name: 'strip-shebang',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.mjs') || !code.startsWith('#!')) return null;
    return {
      code: code.replace(/^#![^\n]*/, (m) => '//' + ' '.repeat(m.length - 2)),
      map: null,
    };
  },
};

export default defineConfig({
  plugins: [stripShebang],
  // Mirrors the `define` block in vite.config.ts. Tests don't load that config, so without
  // this anything importing src/lib/build-id.ts throws "__APP_VERSION__ is not defined".
  // Fixed values, so tests never depend on git state.
  define: {
    __APP_VERSION__: JSON.stringify('v0.0000'),
    __GIT_SHA__: JSON.stringify('test'),
    // 12 entries on purpose: the changelog modal paginates at 10, so the stub has to be long
    // enough for a second page to exist. Newest first, like the real file.
    __CHANGELOG__: JSON.stringify([
      { version: 'v0.0001', date: '2026-01-01', body: 'Test entry' },
      ...Array.from({ length: 11 }, (_, i) => ({
        version: `v0.${String(i + 2).padStart(4, '0')}`,
        date: '2026-01-01',
        body: `Older entry ${i + 1}`,
      })),
    ]),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx,ts,tsx}'],
  },
});
