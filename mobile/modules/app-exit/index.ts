import { requireOptionalNativeModule } from 'expo-modules-core';
import { BackHandler } from 'react-native';

/**
 * A LOCAL Expo module (this directory, autolinked from `modules/` by prebuild), not an npm
 * dependency — three files of Kotlin did not justify a package.
 *
 * `requireOptionalNativeModule`, not `requireNativeModule`: an OTA update carrying this JS can
 * reach a binary built BEFORE the module existed (or the web bundle, which has no Android
 * activity at all). The required variant throws at import time and takes the whole app down on
 * those targets; the optional one hands back null and we degrade to the old behaviour.
 */
const AppExit = requireOptionalNativeModule<{ killApp(): void }>('AppExit');

/**
 * Actually exit: finish the task, drop it from recents, kill the process.
 *
 * On a binary without the native module this falls back to `BackHandler.exitApp()` — which,
 * despite the name, only `moveTaskToBack`s (backgrounds) the app. That was the behaviour the
 * exit dialog shipped with, so old binaries keep exactly what they had.
 */
export function killApp(): void {
  if (AppExit) {
    AppExit.killApp();
  } else {
    BackHandler.exitApp();
  }
}
