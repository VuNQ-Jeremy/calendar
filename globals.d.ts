/**
 * Secrets are invisible to `wrangler types`, so they must be declared here
 * rather than in worker-configuration.d.ts — that file is generated, and every
 * regeneration silently dropped this, breaking workers/translate-proxy.ts.
 * Declaration merging adds it to the generated `interface Env`.
 *
 * ANTHROPIC_API_KEY powers server-side EN→VI translation. Optional: unset means
 * translation is disabled and the flashcard UI degrades gracefully. Set in prod
 * with `wrangler secret put ANTHROPIC_API_KEY`, and in `.dev.vars` locally.
 *
 * ZALO_BOT_TOKEN / ZALO_WEBHOOK_SECRET drive the Zalo notification channel
 * (server/services/zalo.ts). Both optional, and each fails safe on its own: no
 * token means every send no-ops, no secret means the webhook rejects everything.
 * calendar-test deliberately carries only the secret, so e2e can exercise the
 * webhook while nothing is ever delivered to a real person's Zalo.
 */
interface Env {
  ANTHROPIC_API_KEY?: string;
  ZALO_BOT_TOKEN?: string;
  ZALO_WEBHOOK_SECRET?: string;
}

/**
 * A `.wasm` import resolves to a `WebAssembly.Module` — the Cloudflare vite plugin emits it as a
 * `compiled-wasm` module. The Workers runtime refuses to compile wasm from bytes at request time,
 * so importing the module is the only way in; see server/slip/render.ts.
 */
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

/** Injected by vite `define` — see vite.config.ts. e.g. "v0.0042" */
declare const __APP_VERSION__: string;
/** Injected by vite `define` — short git SHA, or "dev" outside a git checkout. */
declare const __GIT_SHA__: string;
/** Injected by vite `define` — CHANGELOG.md parsed at build time, newest first. */
declare const __CHANGELOG__: import('./shared/changelog').ChangelogEntry[];
