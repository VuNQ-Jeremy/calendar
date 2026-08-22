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
 *
 * AUTH_DEV_CODES gates the Zalo OTP dev-code escape (server/services/login-otp.ts): when set,
 * `requestLoginCode`'s response carries the plaintext code alongside the real challengeId, which
 * is what lets the e2e suite drive the flow without a real Zalo delivery. This must exist ONLY in
 * `env.test` (wrangler.jsonc) and `.dev.vars` — it is a code-disclosure oracle by design, so it
 * must never reach `env.prod` or the top-level vars block.
 *
 * EMAIL_API_KEY / EMAIL_FROM / EMAIL_FROM_NAME drive password-reset and verification email
 * (server/services/email.ts, Brevo REST). All optional and fail together: missing either of the
 * first two means every send silently no-ops, same posture as the Zalo token above.
 *
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET drive "Sign in with Google" (web only —
 * server/services/google-auth.ts). Both optional and fail together: either missing means
 * `googleEnabled()` is false, the button is hidden, and /auth/google 404s rather than starting a
 * flow that could never finish.
 *
 * APP_ORIGIN is optional. The app host's origin (e.g. https://app.example.com) once the
 * marketing/app domain split is live (server/origin.ts). Unset means single-host mode: every
 * behavior is identical to before the split existed, and that is the case today — no domain has
 * been purchased yet. Not a secret, but hand-maintained here anyway: `wrangler types` cannot see
 * `vars` either, and would silently drop this the same way it once dropped ANTHROPIC_API_KEY.
 */
interface Env {
  ANTHROPIC_API_KEY?: string;
  PIXABAY_API_KEY?: string;
  ZALO_BOT_TOKEN?: string;
  ZALO_WEBHOOK_SECRET?: string;
  GITHUB_FEEDBACK_TOKEN?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  AUTH_DEV_CODES?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_ORIGIN?: string;
}

/** Injected by vite `define` — see vite.config.ts. e.g. "v0.0042" */
declare const __APP_VERSION__: string;
/** Injected by vite `define` — short git SHA, or "dev" outside a git checkout. */
declare const __GIT_SHA__: string;
/** Injected by vite `define` — CHANGELOG.md parsed at build time, newest first. */
declare const __CHANGELOG__: import('./shared/changelog').ChangelogEntry[];
