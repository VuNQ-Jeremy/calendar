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

export function useGameSocket(code: string): { view: PvpView; send: (m: ClientMsg) => void } {
  const [view, setView] = React.useState<PvpView>({ phase: 'connecting' });
  const wsRef = React.useRef<WebSocket | null>(null);
  const attemptRef = React.useRef(0);
  const pingTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = React.useRef(false);

  React.useEffect(() => {
    closedByUs.current = false;
    attemptRef.current = 0;

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      const ws = new WebSocket(`${proto}${location.host}/game-ws?code=${encodeURIComponent(code)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 30_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerMsg;
          setView((v) => applyServerMsg(v, msg));
        } catch {
          // Not JSON — the DO's own 'pong' auto-response never reaches here as a message event.
        }
      };
      ws.onclose = () => {
        if (pingTimer.current) clearInterval(pingTimer.current);
        if (closedByUs.current) return;
        const delay = RECONNECT_DELAYS_MS[attemptRef.current];
        if (delay === undefined) {
          setView({ phase: 'error', code: 'connection_lost' });
          return;
        }
        attemptRef.current++;
        reconnectTimer.current = setTimeout(connect, delay);
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
