// worker/index.js — thin wrapper kept for worker tests.
// Production entry is workers/app.ts; this file is used by wrangler.test.jsonc.
import { handleApi } from './api.ts';

const fail = (message, status = 500) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (e) {
        return fail(String((e && e.message) || e));
      }
    }
    return env.ASSETS.fetch(request);
  },
};
