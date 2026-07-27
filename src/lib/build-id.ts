/**
 * Which build is running, as one string: "v0.0042 · a1b2c3d".
 *
 * Both halves are injected at build time by vite `define` (see vite.config.ts) and degrade
 * to "v0.0000 · dev" outside a git checkout. Shown in the sidebar and attached to every
 * feedback submission, so a bug report always identifies the code it came from.
 */
export const BUILD_ID = `${__APP_VERSION__} · ${__GIT_SHA__}`;
