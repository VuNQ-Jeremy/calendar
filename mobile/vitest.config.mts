import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The mobile logic suite.
 *
 * Runs in plain Node, NOT a React Native runtime — so it covers `lib/` (the HTTP client, the
 * offline queue, the local cache, the date helpers) and deliberately not the screens or games.
 * Those need a renderer, and the jest-expo + React Native Testing Library stack that would
 * provide one cannot currently be installed here: react-native 0.86 pins
 * `@react-native/jest-preset` to exactly 0.86.0 while jest-expo requires ^0.86.2, and
 * `--legacy-peer-deps` resolves that by REMOVING `@react-native/babel-preset` and
 * `@react-native/metro-babel-transformer` — the packages Metro needs to bundle the app. Trading
 * the shipping path for component tests is not a trade worth making; revisit when the peer
 * ranges line up. The games' actual logic lives in `@mochi/shared/logic/flashcards`, which the
 * repo-root suite already covers.
 *
 * The aliases below replace the native modules `lib/` touches. Aliasing the NATIVE module
 * rather than mocking this app's own `lib/db.ts` is load-bearing twice over:
 *
 *   1. `vi.mock('./db')` still lets `expo-sqlite` be imported, which pulls in React Native's
 *      Flow-typed `index.js` and dies at parse with `Expected 'from', got 'typeOf'`.
 *   2. Stubbing at the native boundary means `lib/db.ts` runs FOR REAL — so the outbox tests
 *      execute the actual schema and the actual `WHERE` clauses, not a hand-written fake that
 *      would happily agree with a broken query.
 */
const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'expo-constants': at('./test/stubs/expo-constants.ts'),
      'expo-sqlite': at('./test/stubs/expo-sqlite.ts'),
      'expo-crypto': at('./test/stubs/expo-crypto.ts'),
      '@react-native-async-storage/async-storage': at('./test/stubs/async-storage.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
