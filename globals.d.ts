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
 *
 * GITHUB_FEEDBACK_TOKEN opens a GitHub issue for every new feedback row
 * (server/services/github.ts), which in turn fires a claude.ai brainstorm
 * routine. Optional and fails safe: unset means the issue post silently no-ops.
 *
 * AZURE_SPEECH_KEY / AZURE_SPEECH_REGION power pronunciation scoring for the vocabulary
 * "pronounce" game (app/routes/speech-assess.tsx). Optional and fail safe together: either
 * unset means /speech-assess returns 503 and the game shows its "not set up yet" notice.
 * calendar-test deliberately carries neither, so e2e stubs the route.
 */
interface Env {
  ANTHROPIC_API_KEY?: string;
  PIXABAY_API_KEY?: string;
  ZALO_BOT_TOKEN?: string;
  ZALO_WEBHOOK_SECRET?: string;
  GITHUB_FEEDBACK_TOKEN?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
}

/** Injected by vite `define` — see vite.config.ts. e.g. "v0.0042" */
declare const __APP_VERSION__: string;
/** Injected by vite `define` — short git SHA, or "dev" outside a git checkout. */
declare const __GIT_SHA__: string;
/** Injected by vite `define` — CHANGELOG.md parsed at build time, newest first. */
declare const __CHANGELOG__: import('./shared/changelog').ChangelogEntry[];
