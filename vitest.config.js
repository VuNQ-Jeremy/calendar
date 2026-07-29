import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Mirrors the `define` block in vite.config.ts. Tests don't load that config, so without
  // this anything importing src/lib/build-id.ts throws "__APP_VERSION__ is not defined".
  // Fixed values, so tests never depend on git state.
  define: {
    __APP_VERSION__: JSON.stringify('v0.0000'),
    __GIT_SHA__: JSON.stringify('test'),
    __CHANGELOG__: JSON.stringify([{ version: 'v0.0001', date: '2026-01-01', body: 'Test entry' }]),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx,ts,tsx}'],
  },
});
