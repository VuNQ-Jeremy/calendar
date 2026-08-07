import React from 'react';
import * as Updates from 'expo-updates';

/**
 * Apply a pending OTA update DURING the splash screen, so one launch is enough.
 *
 * ## The problem this solves
 *
 * `updates.fallbackToCacheTimeout: 0` (app.config.ts) means the native layer never waits: the app
 * launches from the cached bundle, downloads any new one in the background, and applies it on the
 * NEXT launch. Correct for launch speed, but it produced a ritual — open, force-close, open again —
 * and nobody outside this repo knows to do that. A student never sees the fix.
 *
 * Raising `fallbackToCacheTimeout` is the native answer, and it is unavailable: the value is baked
 * into AndroidManifest as `expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS`
 * (`UpdatesConfiguration.kt`), so it needs a new APK, not an OTA update.
 *
 * So we do it in JS. The root layout already holds the native splash (`preventAutoHideAsync`) until
 * the session and the language have resolved — this joins that same wait. Check, download, reload,
 * all before anything is on screen. The reload restarts JS, `preventAutoHideAsync` runs again at
 * module scope, and the splash stays up across the handover.
 *
 * ## Why this is the safe place to reload
 *
 * `reloadAsync()` restarts the JS instantly. Anywhere else in the app that is a hazard: a game round
 * in progress has not reached the outbox yet, so restarting mid-round would silently discard a
 * student's work. During the splash there is nothing in progress and nothing to lose — which is why
 * this runs here and nowhere else.
 *
 * ## The budgets, and why the wait is bounded
 *
 * Never let a phone with no signal hang on the splash. Both steps race a timeout; on expiry we give
 * up and launch from cache. The download is NOT cancelled — it keeps going and the update lands on
 * the next launch, which is exactly the old behaviour. Worst case we degrade to what we had.
 *
 * The check is kept tight because nearly every launch pays it and finds nothing. The fetch gets a
 * longer budget because it is rare and the payoff is a student running current code.
 */
const CHECK_BUDGET_MS = 3_000;
const FETCH_BUDGET_MS = 12_000;

/** Resolves to null if `p` has not settled within `ms`. Does not cancel `p`. */
function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const id = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      () => {
        clearTimeout(id);
        resolve(null);
      },
    );
  });
}

/**
 * Returns true only if it is about to reload — in which case the caller must keep holding the
 * splash rather than rendering, because this JS instance is on its way out.
 */
async function applyPendingUpdate(): Promise<boolean> {
  // False in Expo Go and in a dev client, where there is no update to apply and calling these
  // throws. A dev build must not sit on the splash for three seconds every reload.
  if (!Updates.isEnabled || __DEV__) return false;

  const check = await withBudget(Updates.checkForUpdateAsync(), CHECK_BUDGET_MS);
  if (!check?.isAvailable) return false;

  const fetched = await withBudget(Updates.fetchUpdateAsync(), FETCH_BUDGET_MS);
  if (!fetched?.isNew) return false;

  // Resolves only in the sense that the app is going away; nothing after this runs.
  await Updates.reloadAsync();
  return true;
}

/**
 * `true` while the update step is still deciding — the splash must stay up.
 *
 * Runs once, on mount, in parallel with the auth and language reads it shares the splash with, so on
 * the common path (no update) it adds nothing to launch: the check overlaps work that was happening
 * anyway.
 *
 * Note what this deliberately does NOT do: it never reloads a running app. An update published while
 * someone has the app open still waits for their next cold start. That is the trade for never
 * yanking the screen out from under a student mid-round.
 */
export function useUpdateGate(): boolean {
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void applyPendingUpdate().then((reloading) => {
      // Reloading: stay `true` forever. This instance is being replaced, and flipping to false
      // would flash one frame of the OLD bundle's UI before the handover.
      if (!cancelled && !reloading) setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return checking;
}
