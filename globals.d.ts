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
 * PIXABAY_API_KEY powers stock photo search for vocabulary word images
 * (server/services/vocab-images.ts). Optional and fails safe on its own: unset means
 * /vocab-image-search returns 503 and the "find image" UI is hidden, while AI-generated
 * illustrations (Workers AI, no key needed) keep working.
 *
 * ZALO_BOT_TOKEN / ZALO_WEBHOOK_SECRET drive the Zalo notification channel
 * (server/services/zalo.ts). Both optional, and each fails safe on its own: no
 * token means every send no-ops, no secret means the webhook rejects everything.
 * calendar-test deliberately carries only the secret, so e2e can exercise the
 * webhook while nothing is ever delivered to a real person's Zalo.
 */
interface Env {
  ANTHROPIC_API_KEY?: string;
  PIXABAY_API_KEY?: string;
  ZALO_BOT_TOKEN?: string;
  ZALO_WEBHOOK_SECRET?: string;
}

/** Injected by vite `define` — see vite.config.ts. e.g. "v0.0042" */
declare const __APP_VERSION__: string;
/** Injected by vite `define` — short git SHA, or "dev" outside a git checkout. */
declare const __GIT_SHA__: string;
/** Injected by vite `define` — CHANGELOG.md parsed at build time, newest first. */
declare const __CHANGELOG__: import('./shared/changelog').ChangelogEntry[];
