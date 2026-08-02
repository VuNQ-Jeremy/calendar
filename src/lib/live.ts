/**
 * Browser side of the live-update feature.
 *
 * Holds one WebSocket to /ws (see workers/live-hub.ts) and turns each
 * `{type:'invalidate', domain}` message into the same cache effects a local
 * mutation produces, so a change made by someone else — or by the mobile app —
 * shows up without a reload. Mounted once by AppLayout (app/routes/_app.tsx).
 *
 * The socket carries no data, only domain names; the refreshed content still
 * comes through the normal loaders, so nothing here can leak data a user could
 * not already load.
 */
import { markStale } from './cache.js';
import { invalidateAfterRemoteMutation, lastLocalMutation } from './route-cache.js';
import { isMutationDomain, type MutationDomain } from '../../shared/live.js';

/** Domains whose changes move a sidebar badge, and so need the layout loader re-run. */
const BADGE_DOMAINS: ReadonlySet<MutationDomain> = new Set(['people', 'feedback', 'tests']);

/** Ignore a broadcast this tab itself caused within this window. */
const ECHO_WINDOW_MS = 3000;
/** Coalesce a burst of edits to one domain into a single refresh. */
const THROTTLE_MS = 1500;
/** Below Cloudflare's idle-close (~100 s), so the socket is never dropped as idle. */
const PING_INTERVAL_MS = 45_000;
/** No traffic at all for this long means the peer is gone; reconnect. */
const STALL_MS = 2 * PING_INTERVAL_MS + 5000;
const MAX_BACKOFF_MS = 30_000;

/**
 * True while a live update is asking for the layout loader to re-run. Read by
 * shouldRevalidate in app/routes/_app.tsx, which otherwise refuses every
 * revalidator-driven revalidation — that refusal is what keeps ordinary
 * navigation cheap, and this flag is the narrow exception for live updates.
 *
 * It must stay set for the whole revalidation rather than being cleared on
 * read. React Router calls shouldRevalidate several times per revalidation
 * (three, in practice) and honours the LAST answer: a consume-on-read flag
 * returns true once and false afterwards, so React Router decides there is
 * nothing to fetch and the badge never moves.
 */
let layoutRefreshPending = false;

export function isLiveLayoutRefreshPending(): boolean {
  return layoutRefreshPending;
}

/**
 * Open the live connection. `revalidate` is called only when a refresh needs
 * React Router's involvement (badge counts); ordinary route data refreshes
 * itself through the cache subscription. Returns a cleanup function.
 */
export function startLive(revalidate: () => Promise<void> | null): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;
  let everConnected = false;
  let reconnectTimer: number | undefined;
  let lastSeen = Date.now();

  const trailing = new Map<MutationDomain, number>();
  const lastApplied = new Map<MutationDomain, number>();
  const deferredWhileHidden = new Set<MutationDomain>();

  const requestLayoutRefresh = () => {
    layoutRefreshPending = true;
    const running = revalidate();
    // Null means the caller was busy and declined. Leave the flag set so the
    // revalidation already under way — or the next one — still picks it up.
    if (running) void running.finally(() => (layoutRefreshPending = false));
  };

  const apply = (domain: MutationDomain) => {
    lastApplied.set(domain, Date.now());
    invalidateAfterRemoteMutation(domain);
    if (BADGE_DOMAINS.has(domain)) requestLayoutRefresh();
  };

  const handle = (domain: MutationDomain) => {
    if (Date.now() - lastLocalMutation(domain) < ECHO_WINDOW_MS) return;
    // A hidden tab has nothing to show; remember and apply when it comes back.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      deferredWhileHidden.add(domain);
      return;
    }
    const since = Date.now() - (lastApplied.get(domain) ?? 0);
    if (since < THROTTLE_MS) {
      if (!trailing.has(domain)) {
        trailing.set(
          domain,
          window.setTimeout(() => {
            trailing.delete(domain);
            apply(domain);
          }, THROTTLE_MS - since),
        );
      }
      return;
    }
    apply(domain);
  };

  const connect = () => {
    if (stopped) return;
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    let socket: WebSocket;
    try {
      socket = new WebSocket(scheme + location.host + '/ws');
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      attempts = 0;
      lastSeen = Date.now();
      if (everConnected) {
        // Messages sent while we were disconnected (sleep, deploy, flaky wifi)
        // are gone. Assume everything cached is suspect and refresh.
        markStale('route:');
        requestLayoutRefresh();
      }
      everConnected = true;
    };

    socket.onmessage = (ev) => {
      lastSeen = Date.now();
      if (typeof ev.data !== 'string' || ev.data === 'pong') return;
      try {
        const msg = JSON.parse(ev.data) as { type?: unknown; domain?: unknown };
        if (msg.type === 'invalidate' && isMutationDomain(msg.domain)) handle(msg.domain);
      } catch {
        // Not our protocol — ignore rather than tear the socket down.
      }
    };

    socket.onclose = () => {
      if (ws === socket) ws = null;
      scheduleReconnect();
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        // Already closing; onclose still fires.
      }
    };
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== undefined) return;
    // A hidden tab reconnects on visibilitychange instead, so a backgrounded
    // laptop does not sit in a retry loop.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts);
    attempts++;
    const delay = base * (0.7 + Math.random() * 0.6);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  };

  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    // Drain first: handle() re-reads the set on the hidden path.
    const deferred = Array.from(deferredWhileHidden);
    deferredWhileHidden.clear();
    for (const domain of deferred) handle(domain);
    if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      attempts = 0;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      connect();
    }
  };

  const heartbeat = window.setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastSeen > STALL_MS) {
      try {
        ws.close();
      } catch {
        // Already gone.
      }
      return;
    }
    try {
      // Answered by the hub's auto-response pair without waking it.
      ws.send('ping');
    } catch {
      // Send on a dying socket; onclose handles the reconnect.
    }
  }, PING_INTERVAL_MS);

  document.addEventListener('visibilitychange', onVisibility);
  connect();

  return () => {
    stopped = true;
    // The shell is going away (logout, mostly); a pending layout refresh for a
    // session that no longer exists would only make the next one revalidate.
    layoutRefreshPending = false;
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearTimeout(reconnectTimer);
    window.clearInterval(heartbeat);
    for (const id of trailing.values()) window.clearTimeout(id);
    trailing.clear();
    try {
      ws?.close(1000, 'unmount');
    } catch {
      // Already closed.
    }
  };
}
