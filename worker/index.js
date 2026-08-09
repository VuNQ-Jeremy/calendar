// worker/index.js — stub entry point for wrangler.test.jsonc.
// The /api/* handler was removed in phase-3 (all data goes through RR7 loaders/actions).
//
// The /ws route and the LiveHub re-export are not dead weight: vitest-pool-workers
// builds Durable Objects from this module, and test-worker/live-hub.test.js drives
// the real upgrade handler through SELF.
import { handleLiveUpgrade } from '../workers/live-hub';

export { LiveHub } from '../workers/live-hub';

// Same reason: test-worker/zalo.test.js exercises the poller's alarm loop, and
// vitest-pool-workers can only instantiate a Durable Object the entry module exports.
export { ZaloPoller } from '../workers/zalo-poller';

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/ws') return handleLiveUpgrade(request, env);
    return env.ASSETS.fetch(request);
  },
};
