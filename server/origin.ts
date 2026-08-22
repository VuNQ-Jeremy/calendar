/**
 * The one place that knows the app/marketing host split.
 *
 * APP_ORIGIN (e.g. "https://app.mochi.example") is OPTIONAL. Unset — the
 * situation today, before a domain is purchased — every host serves both the
 * app and the marketing pages exactly as before this file existed. Set, the
 * apex becomes marketing-only and APP_ORIGIN's host (plus workers.dev, which
 * existing users and the mobile app still point at) serves the app.
 */

export function appOrigin(env: Env): string | null {
  const v = env.APP_ORIGIN?.trim();
  if (!v) return null;
  try {
    return new URL(v).origin;
  } catch {
    return null; // a malformed var must never take the site down
  }
}

/** Does the host this request arrived on serve the app (vs marketing only)? */
export function isAppHost(request: Request, env: Env): boolean {
  const origin = appOrigin(env);
  if (!origin) return true; // single-host mode: every host is the app host
  const host = new URL(request.url).host;
  return host === new URL(origin).host || host.endsWith('.workers.dev');
}

/** Href for an app destination: absolute when the split is on, relative before. */
export function appUrl(env: Env, path: string): string {
  const origin = appOrigin(env);
  return origin ? origin + path : path;
}
