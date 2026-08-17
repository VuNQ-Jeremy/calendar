/**
 * `expo-crypto`, minus the native module.
 *
 * The UUID is a counter rather than a real random one so a failing outbox test names the row it
 * is complaining about (`uuid-2`) instead of a fresh hex string on every run. `resetUuids` is
 * exported for suites that assert on those names; `vi.resetModules()` resets it too.
 */
let n = 0;

export const randomUUID = () => `uuid-${++n}`;

export const resetUuids = () => {
  n = 0;
};
