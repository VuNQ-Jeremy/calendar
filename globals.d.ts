/**
 * Secrets are invisible to `wrangler types`, so they must be declared here
 * rather than in worker-configuration.d.ts — that file is generated, and every
 * regeneration silently dropped this, breaking workers/translate-proxy.ts.
 * Declaration merging adds it to the generated `interface Env`.
 *
 * ANTHROPIC_API_KEY powers server-side EN→VI translation. Optional: unset means
 * translation is disabled and the flashcard UI degrades gracefully. Set in prod
 * with `wrangler secret put ANTHROPIC_API_KEY`, and in `.dev.vars` locally.
 */
interface Env {
  ANTHROPIC_API_KEY?: string;
}

/** Injected by vite `define` — see vite.config.ts. e.g. "v0.0042" */
declare const __APP_VERSION__: string;
/** Injected by vite `define` — short git SHA, or "dev" outside a git checkout. */
declare const __GIT_SHA__: string;
/** Injected by vite `define` — CHANGELOG.md parsed at build time, newest first. */
declare const __CHANGELOG__: import('./shared/changelog').ChangelogEntry[];
