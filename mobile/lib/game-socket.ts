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

/**
 * What a close means: retry after `delayMs`, or give up with this error code.
 *
 * This covers only the closes that arrive with NO explanation at all: a 401 or a 426 (never
 * upgraded, so `onopen` never fires) or the worker being down. The three refusals that DO get a
 * socket now — unknown code, full lobby, already-started game — explain themselves over the wire
 * first (`room-error`, handled by `applyServerMsg` via `onMsg`, see `workers/game-room.ts`
 * `refuse()`), so this function never needs to be consulted for those; `connect()` below
 * suppresses the close that follows a `room-error` before it ever reaches here (see
 * `roomErrorReceived`).
 *
 * The distinguishing signal for the closes that DO reach here is `everOpened`: only a socket
 * whose `onopen` actually fired earns the reconnect backoff. A close on the very first attempt,
 * before `onopen`, is treated as the room simply not existing — the best available guess (a
 * mistyped code is the overwhelmingly likely cause of a 401/426), and far better than a silent
 * 7-second `connection_lost` for what usually amounts to a typo. A socket that DID open and later
 * drops (server restart, network blip) still gets the normal backoff/give-up ladder.
 */
export function closeOutcome(
  everOpened: boolean,
  attempt: number,
): { retryInMs: number } | { errorCode: 'not_found' | 'connection_lost' } {
  if (!everOpened && attempt === 0) return { errorCode: 'not_found' };
  const delay = backoffDelay(attempt);
  return delay === null ? { errorCode: 'connection_lost' } : { retryInMs: delay };
}

export function connectGameSocket(
  code: string,
  opts: {
    getToken: () => Promise<string | null>;
    onMsg: (msg: ServerMsg) => void;
    onClose: (errorCode: 'not_found' | 'connection_lost') => void;
  },
): { send: (m: ClientMsg) => void; close: () => void } {
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let everOpened = false;
  let closedByUs = false;
  // A `room-error` for anything but `not_host` (see `workers/game-room.ts` `refuse()`) is
  // terminal: the DO closes the socket from its side too, but we do not rely on that close
  // arriving (hibernation could discard its deferred timer, or `close()` could throw) — we close
  // from here as well, in `onmessage` below. This flag is still needed regardless of who closes
  // first: without it, that close reaches `onclose` looking exactly like an ordinary drop —
  // `everOpened` is already true because the handshake DID succeed (a refusal is still a 101) —
  // so `closeOutcome` would schedule a reconnect into the very same refusal, and after three
  // retries stomp the specific error the player already saw with a generic "connection lost".
  // `not_host` never closes the socket (the game continues), so gating on the code rather than
  // the message type keeps that case retryable.
  let roomErrorReceived = false;

  function connect() {
    void (async () => {
      const token = await opts.getToken();
      // `close()` can run while we're still awaiting the token above — `ws` is still null then,
      // so `close()` only sets `closedByUs` and has nothing to actually close. Without this
      // re-check we'd construct the socket anyway; `onopen` would start the 30s ping interval,
      // and nothing would ever clear it or the socket on a fast unmount.
      if (closedByUs) return;
      const url = gameSocketUrl(BASE, code);
      // The headers option is React Native's WebSocket extension over the browser API.
      const Ctor = WebSocket as unknown as RNWebSocketCtor;
      ws = new Ctor(url, undefined, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      ws.onopen = () => {
        attempt = 0;
        everOpened = true;
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send('ping');
        }, 30_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMsg;
          if (msg?.type === 'room-error' && msg.code !== 'not_host') {
            roomErrorReceived = true;
            ws?.close();
          }
          opts.onMsg(msg);
        } catch {
          // Not JSON.
        }
      };
      ws.onclose = (ev) => {
        if (pingTimer) clearInterval(pingTimer);
        // The DO only ever sends code 1000 deliberately (`'bye'` on finish, `'expired'` on an
        // abandoned lobby, or a refusal's close) — a genuine drop always arrives as 1006. Without
        // this check, the DO's post-finish `ws.close(1000, 'bye')` looked exactly like a drop:
        // `everOpened` was already true, so `closeOutcome` returned a reconnect, which found the
        // room gone (deleted right after the close) and replaced the finish/podium view with
        // "Room not found".
        if (closedByUs || roomErrorReceived || ev.code === 1000) return;
        const outcome = closeOutcome(everOpened, attempt);
        if ('errorCode' in outcome) {
          opts.onClose(outcome.errorCode);
          return;
        }
        attempt++;
        reconnectTimer = setTimeout(connect, outcome.retryInMs);
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
