/**
 * `expo-constants`, minus the native module.
 *
 * `lib/api.ts` reads `Constants.expoConfig.extra.apiUrl` — the value `app.config.ts` inlines at
 * build time. The default here is deliberately a URL WITH a trailing slash so the tests that
 * assert `BASE` strips it have something to strip; tests that need a different shape (a missing
 * key, or the `{}` that caused the 2026-07-29 pre-frame crash) override `expoConfig` directly.
 */
const Constants = {
  expoConfig: {
    extra: { apiUrl: 'https://config.example.com/' } as Record<string, unknown>,
  } as { extra: Record<string, unknown> } | null,
};

export default Constants;
