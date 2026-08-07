import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as outbox from './outbox';
import * as store from './offline-topics';
import { invalidateGarden } from './query';

/**
 * Background sync. Mounted once, by the signed-in layout.
 *
 * Two jobs, on the same triggers:
 *   - **Flush the outbox** — push finished games that have not reached the server.
 *   - **Refresh downloaded topics** — so offline content does not silently go stale.
 *
 * Triggers: app foreground (`AppState` → `active`) and network reconnect. Games also flush
 * immediately on finish when online; this is the safety net for everything else.
 *
 * Everything here is fire-and-forget and failure-tolerant. Nothing the user does may block on
 * it, and nothing it does may surface an error — the outbox retries with backoff on its own.
 */
export function useSync(enabled: boolean): void {
  // Guards against two flushes overlapping (foreground and reconnect often fire together).
  const running = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const run = async (refreshContent: boolean) => {
      if (running.current) return;
      running.current = true;
      try {
        const flushed = await outbox.flush(new Date());
        // Rounds played offline grew the plant on arrival, but nothing was on screen to say so —
        // and a replayed result reports no outcome by design. Re-read the plant instead of trying
        // to reconstruct a celebration for a round the student finished hours ago.
        if (flushed.recorded > 0) void invalidateGarden();
        if (refreshContent) await store.refreshDownloaded(new Date());
      } catch {
        /* retried on the next trigger */
      } finally {
        running.current = false;
      }
    };

    // On mount: push anything left over from the last run.
    void run(false);

    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run(true);
    });

    let wasConnected: boolean | null = null;
    const netUnsub = NetInfo.addEventListener((s) => {
      const connected = !!s.isConnected;
      // Only on the transition into connectivity — NetInfo fires often, and re-flushing on every
      // event would hammer the API on a flaky connection.
      if (connected && wasConnected === false) void run(true);
      wasConnected = connected;
    });

    return () => {
      appSub.remove();
      netUnsub();
    };
  }, [enabled]);
}
