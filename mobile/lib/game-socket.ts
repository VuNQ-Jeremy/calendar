import { BASE } from './api';
import type { ClientMsg, ServerMsg } from '@mochi/shared/logic/pvp';

/**
 * PvP battle room socket client (F33/F34). Transport only — the pure `applyServerMsg` reducer
 * in `@mochi/shared/logic/pvp` is the ONLY place a message becomes UI state, so this file and
 * `src/lib/game-socket.ts` on the web cannot disagree about what a phase means.
 *
 * Bearer auth, not a cookie: React Native has no cookie jar, same as every other call in
 * `lib/api.ts`. React Native's WebSocket implementation accepts a headers object as the third
 * constructor argument, which is how the token rides the handshake.
 */

const RECONNECT_DELAYS_MS = [1000, 2000, 4000];

/**
 * React Native's WebSocket accepts a third constructor argument (`{ headers }`) that the
 * standard DOM lib type does not declare — this is the shape that extension actually has.
 */
type RNWebSocketCtor = new (
  url: string,
  protocols: string | string[] | undefined,
  options: { headers?: Record<string, string> } | undefined,
) => WebSocket;

/** http(s) base -> ws(s) game-room URL, code appended as `?code=`. */
export function gameSocketUrl(base: string, code: string): string {
  const scheme = base.startsWith('https:') ? 'wss:' : 'ws:';
  const rest = base.replace(/^https?:/, '');
  return `${scheme}${rest}/game-ws?code=${encodeURIComponent(code)}`;
}

/** The delay before reconnect attempt `attempt` (0-indexed), or null once attempts are exhausted. */
export function backoffDelay(attempt: number): number | null {
  return RECONNECT_DELAYS_MS[attempt] ?? null;
}

export function connectGameSocket(
  code: string,
  opts: {
    getToken: () => Promise<string | null>;
    onMsg: (msg: ServerMsg) => void;
    onClose: () => void;
  },
): { send: (m: ClientMsg) => void; close: () => void } {
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closedByUs = false;

  function connect() {
    void (async () => {
      const token = await opts.getToken();
      const url = gameSocketUrl(BASE, code);
      // The headers option is React Native's WebSocket extension over the browser API.
      const Ctor = WebSocket as unknown as RNWebSocketCtor;
      ws = new Ctor(url, undefined, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      ws.onopen = () => {
        attempt = 0;
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send('ping');
        }, 30_000);
      };
      ws.onmessage = (ev) => {
        try {
          opts.onMsg(JSON.parse(ev.data as string) as ServerMsg);
        } catch {
          // Not JSON.
        }
      };
      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (closedByUs) return;
        const delay = backoffDelay(attempt);
        if (delay === null) {
          opts.onClose();
          return;
        }
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };
    })();
  }

  connect();

  return {
    send: (m: ClientMsg) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    close: () => {
      closedByUs = true;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
