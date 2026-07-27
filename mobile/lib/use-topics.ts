import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNetInfo } from '@react-native-community/netinfo';
import * as api from '~/lib/endpoints';
import * as store from '~/lib/offline-topics';
import * as outbox from '~/lib/outbox';
import { qk } from '~/lib/query';
import type { TopicBundle } from '~/lib/types';

/**
 * The flashcard data hooks, and the place the online and offline paths meet.
 *
 * The rule throughout: **network is an optimisation, never a requirement.** A downloaded topic
 * reads from SQLite; a finished game goes to the outbox first and the server second.
 */

/** Topic list. Falls back to whatever is downloaded when the request fails. */
export function useTopics() {
  const net = useNetInfo();
  const online = net.isConnected !== false;

  const query = useQuery({
    queryKey: qk.flashcardTopics,
    queryFn: api.flashcards.listTopics,
    // React Query's persister keeps the last successful list across restarts, so a cold start
    // offline still shows the topics — greyed download states and all.
    networkMode: 'always',
  });

  const downloaded = useDownloaded();

  return { ...query, online, downloaded };
}

/** Which topics are on disk, with their last refresh time. Re-read after any download change. */
export function useDownloaded() {
  const [map, setMap] = useState<Map<string, string>>(new Map());

  const reload = useCallback(async () => {
    try {
      const rows = await store.listDownloaded();
      setMap(new Map(rows.map((r) => [r.topicId, r.syncedAt])));
    } catch {
      setMap(new Map());
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { map, reload };
}

export type TopicSource = 'network' | 'offline';

export interface TopicState {
  bundle: TopicBundle | null;
  source: TopicSource | null;
  syncedAt: string | null;
  loading: boolean;
  /** True when we are offline AND this topic was never downloaded — a dead end, so say so. */
  unavailableOffline: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * One topic, from the network when possible and from SQLite when not.
 *
 * Deliberately not a bare `useQuery`: the offline case is not an error state, and a spinner that
 * never resolves is the single worst outcome for a student on a bus. When there is no network
 * and no download, this returns `unavailableOffline` so the screen can say exactly that.
 */
export function useTopic(slug: string): TopicState {
  const net = useNetInfo();
  const online = net.isConnected !== false;

  const [state, setState] = useState<Omit<TopicState, 'refetch'>>({
    bundle: null,
    source: null,
    syncedAt: null,
    loading: true,
    unavailableOffline: false,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));

      // Read the stored copy first — it costs a few ms and means a slow network shows content
      // immediately instead of a spinner.
      const stored = await store.readTopic(slug).catch(() => null);
      if (cancelled) return;
      if (stored) {
        setState({
          bundle: stored.bundle,
          source: 'offline',
          syncedAt: stored.syncedAt,
          loading: online,
          unavailableOffline: false,
          error: null,
        });
      }

      if (!online) {
        if (!stored && !cancelled) {
          setState({
            bundle: null,
            source: null,
            syncedAt: null,
            loading: false,
            unavailableOffline: true,
            error: null,
          });
        }
        return;
      }

      try {
        const bundle = await api.flashcards.topic(slug);
        if (cancelled) return;
        // Refresh the stored copy silently, but only if this topic was downloaded — opening a
        // topic must not quietly start using the student's data allowance for offline storage.
        if (stored) await store.saveTopic(bundle, new Date().toISOString());
        setState({
          bundle,
          source: 'network',
          syncedAt: stored ? new Date().toISOString() : null,
          loading: false,
          unavailableOffline: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        // A failed request with a stored copy is not an error the user needs to see.
        setState((s) =>
          s.bundle
            ? { ...s, loading: false }
            : {
                bundle: null,
                source: null,
                syncedAt: null,
                loading: false,
                unavailableOffline: false,
                error: err instanceof Error ? err.message : 'err_generic_msg',
              },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, online, nonce]);

  return { ...state, refetch: () => setNonce((n) => n + 1) };
}

/** Download / remove-download for one topic. */
export function useTopicDownload(onChanged: () => void) {
  const download = useMutation({
    mutationFn: (slug: string) => store.downloadTopic(slug, new Date()),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: (topicId: string) => store.removeTopic(topicId),
    onSuccess: onChanged,
  });
  return { download, remove };
}

/**
 * The count behind "3 waiting to sync", kept current by polling the outbox table.
 *
 * Polling rather than an event bus because SQLite has no change notifications here and the
 * number moves rarely; a 3-second tick is invisible and cannot get out of step.
 */
export function usePendingSync(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const read = () => {
      outbox
        .pendingCount()
        .then((n) => {
          if (alive) setCount(n);
        })
        .catch(() => {});
    };
    read();
    const id = setInterval(read, 3_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return count;
}

/** Invalidate the flashcard queries after a staff mutation. Mirrors the web's narrow case. */
export function useInvalidateFlashcards() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['flashcards'] }), [qc]);
}
