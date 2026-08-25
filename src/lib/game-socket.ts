import React from 'react';
import {
  applyServerMsg,
  type ClientMsg,
  type PvpView,
  type ServerMsg,
} from '../../shared/logic/pvp';

/**
 * Web socket client for a PvP battle room. Transport only — every bit of game logic lives in
 * the shared `applyServerMsg` reducer, so the web and mobile battle screens cannot drift.
 *
 * The cookie rides automatically on a same-origin `wss://` handshake, exactly like `src/lib/live.ts`.
 */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000];

/** The delay before reconnect attempt `attempt` (0-indexed), or null once attempts are exhausted. */
function backoffDelay(attempt: number): number | null {
  return RECONNECT_DELAYS_MS[attempt] ?? null;
}

/**
 * What a close means: retry after `delayMs`, or give up with this error code.
 *
 * This is deliberately the same shape as `backoffDelay`/`closeOutcome` in `mobile/lib/game-socket.ts`
 * — the two files share no code (see the file doc comment), but the reconnect contract they
 * implement is the same one. This covers only closes that arrive with NO explanation at all: a
 * 401 or a 426 (never upgraded, so `onopen` never fires) or the worker being down. The three
 * refusals that DO get a socket — unknown code, full lobby, already-started game — explain
 * themselves over the wire first (`room-error`, handled by `applyServerMsg`, see
 * `workers/game-room.ts` `refuse()`), so `connect()` below suppresses the close that follows a
 * `room-error` before it ever reaches here (see `roomErrorReceived`).
 *
 * The distinguishing signal for the closes that DO reach here is `everOpened`: only a socket
 * whose `onopen` actually fired earns the reconnect backoff. A close on the very first attempt,
 * before `onopen`, is treated as the room simply not existing — the best available guess (a
 * mistyped code is the overwhelmingly likely cause of a 401/426), and far better than a silent
 * 7-second `connection_lost` for what usually amounts to a typo.
 */
function closeOutcome(
  everOpened: boolean,
  attempt: number,
): { retryInMs: number } | { errorCode: 'not_found' | 'connection_lost' } {
  if (!everOpened && attempt === 0) return { errorCode: 'not_found' };
  const delay = backoffDelay(attempt);
  return delay === null ? { errorCode: 'connection_lost' } : { retryInMs: delay };
}

export function useGameSocket(code: string): { view: PvpView; send: (m: ClientMsg) => void } {
  const [view, setView] = React.useState<PvpView>({ phase: 'connecting' });
  const wsRef = React.useRef<WebSocket | null>(null);
  const attemptRef = React.useRef(0);
  const everOpenedRef = React.useRef(false);
  const pingTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = React.useRef(false);
  // See `roomErrorReceived` in mobile/lib/game-socket.ts: a room-error that closes the socket
  // (anything but `not_host`) must not also trigger a reconnect — `everOpened` is already true
  // by then (a refusal is still a 101), so without this the reconnect ladder would retry into the
  // same refusal and, after three attempts, stomp the specific error already on screen with a
  // generic "connection lost". We also close the socket ourselves in `onmessage` below rather
  // than relying solely on the DO's deferred close (hibernation could discard its 0 ms timer, or
  // `close()` could throw) — this flag still has to gate `onclose` either way, since our own
  // `close()` also raises a close event.
  const roomErrorReceived = React.useRef(false);

  React.useEffect(() => {
    closedByUs.current = false;
    attemptRef.current = 0;
    everOpenedRef.current = false;
    roomErrorReceived.current = false;

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const ws = new WebSocket(`${proto}${location.host}/game-ws?code=${encodeURIComponent(code)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        everOpenedRef.current = true;
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 30_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerMsg;
          if (msg?.type === 'room-error' && msg.code !== 'not_host') {
            roomErrorReceived.current = true;
            ws.close();
          }
          setView((v) => applyServerMsg(v, msg));
        } catch {
          // Not JSON — the DO's own 'pong' auto-response never reaches here as a message event.
        }
      };
      ws.onclose = (ev) => {
        if (pingTimer.current) clearInterval(pingTimer.current);
        // The DO only ever sends code 1000 deliberately (`'bye'` on finish, `'expired'` on an
        // abandoned lobby, or a refusal's close) — a genuine drop (server restart, network blip,
        // tab backgrounding) always arrives as 1006. Without this check, the DO's post-finish
        // `ws.close(1000, 'bye')` looked exactly like a drop: `everOpened` was already true, so
        // `closeOutcome` returned a reconnect, which found the room gone (deleted right after the
        // close) and replaced the finish/podium view with "Room not found".
        if (closedByUs.current || roomErrorReceived.current || ev.code === 1000) return;
        const outcome = closeOutcome(everOpenedRef.current, attemptRef.current);
        if ('errorCode' in outcome) {
          setView({ phase: 'error', code: outcome.errorCode });
          return;
        }
        attemptRef.current++;
        reconnectTimer.current = setTimeout(connect, outcome.retryInMs);
      };
    }

    connect();
    return () => {
      closedByUs.current = true;
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [code]);

  const send = React.useCallback((m: ClientMsg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(m));
  }, []);

  return { view, send };
}
