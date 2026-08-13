import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks for navigation latency (see docs/navigation-latency-plan.md).
 *
 * These run against a REAL deployment: this project has no working local dev
 * server, so `npm run deploy` first, then point E2E_BASE_URL wherever you want.
 *
 *   MOCHI_EMAIL=... MOCHI_PASSWORD=... npm run test:e2e
 *
 * Without credentials every spec skips itself rather than failing.
 *
 * To run against the isolated calendar-test environment (own D1/R2, seed data
 * reset before every run, safe for CRUD specs): npm run test:e2e:staging.
 * One-time provisioning: npm run test:env:setup — see scripts/test-env-setup.mjs.
 */
export default defineConfig({
  testDir: './e2e',
  // Every assertion here is about network behaviour (cache hits, prefetch,
  // pending UI), so parallel workers would fight over bandwidth and add noise.
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://calendar.ngqv0712.workers.dev',
    // System Edge by default, which avoids a ~150 MB chromium download.
    // Set E2E_CHANNEL=chromium (after `npx playwright install chromium`) to
    // use Playwright's bundled build instead.
    channel: process.env.E2E_CHANNEL || 'msedge',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    // The pronounce game (crud-pronounce.spec.ts) records through getUserMedia. The fake
    // device makes Chromium/Edge emit a synthetic tone instead of touching real hardware,
    // and the fake UI + permission grant skip the mic prompt no test could click.
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
});
