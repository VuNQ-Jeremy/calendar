/**
 * In-memory stand-in for `@react-native-async-storage/async-storage`.
 *
 * Aliased at the NATIVE boundary (see vitest.config.ts) rather than mocking this app's own
 * modules, for the same reason the expo-sqlite stub is: the code under test then runs for real,
 * including its try/catch around a store that can be unavailable.
 */
const store = new Map<string, string>();

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return store.has(key) ? store.get(key)! : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
  async clear(): Promise<void> {
    store.clear();
  },
  /** Test-only escape hatch, so a spec can start from a known empty store. */
  __reset(): void {
    store.clear();
  },
};

export default AsyncStorage;
