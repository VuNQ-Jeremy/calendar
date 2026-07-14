// worker/index.js — stub entry point for wrangler.test.jsonc.
// The /api/* handler was removed in phase-3 (all data goes through RR7 loaders/actions).
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
