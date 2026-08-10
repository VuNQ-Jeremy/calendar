import { DurableObject } from 'cloudflare:workers';
import { createDb } from '../server/db/index';
import { sessionCookie } from '../server/session';
import { userFromToken } from '../server/services/auth';
import { isMutationDomain, STUDENT_LIVE_DOMAINS, type MutationDomain } from '../shared/live';

/**
 * Fan-out hub for live cache invalidation.
 *
 * Every browser tab holds one WebSocket to a single global instance
 * (`idFromName('global')`). After a successful mutation the server posts a
 * domain name to /broadcast (see server/live.ts) and the hub relays
 * `{type:'invalidate', domain}` to every connected socket. The client feeds
 * that into the existing SWR cache (src/lib/live.ts), so a change made in one
 * tab — or from the mobile app — surfaces everywhere without a reload.
 *
 * Uses the WebSocket **Hibernation** API rather than addEventListener: the
 * runtime keeps the sockets open while evicting this object from memory, so
 * idle connections accrue no duration charges. That is what makes a
 * permanently-connected client viable on the free plan. Consequences to
 * respect when editing:
 *   - use ctx.acceptWebSocket(server), never server.accept();
 *   - handlers are class methods (webSocketMessage/Close/Error), not listeners;
 *   - per-socket state lives in serializeAttachment (survives eviction, 2 KB cap);
 *   - the constructor re-runs on every wake, so setup belongs there.
 */

type SocketTag = { kind: 'staff' | 'student' | 'parent'; userId: string };

export class LiveHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answer client keepalives in the runtime itself. Without this every ping
    // would wake the object from hibernation, which is the one thing that
    // would make idle sockets cost money.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/broadcast') return this.handleBroadcast(request);
    if (pathname === '/connect') return this.handleConnect(request);
    return new Response('not found', { status: 404 });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    let domain: unknown;
    try {
      ({ domain } = (await request.json()) as { domain?: unknown });
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (!isMutationDomain(domain))
      return Response.json({ error: 'unknown_domain' }, { status: 400 });

    const message = JSON.stringify({ type: 'invalidate', domain, ts: Date.now() });
    let delivered = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const tag = ws.deserializeAttachment() as SocketTag | null;
      if (!tag) continue;
      if (tag.kind === 'student' && !STUDENT_LIVE_DOMAINS.has(domain as MutationDomain)) continue;
      // A parent's app is /profile, and nothing broadcasts a profile edit back to its own
      // author. They connect (the socket is opened by the app shell) and receive nothing.
      if (tag.kind === 'parent') continue;
      try {
        ws.send(message);
        delivered++;
      } catch {
        // Socket is mid-close; webSocketClose/webSocketError reaps it.
      }
    }
    return Response.json({ ok: true, delivered });
  }

  // Named handleConnect, not connect: DurableObject declares a `connect(socket)`
  // method for raw TCP and overriding it with a different signature is an error.
  private async handleConnect(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    // Identity was established by handleLiveUpgrade before this request was
    // forwarded here; it overwrites these headers, so a client cannot set them.
    const kind = request.headers.get('X-Live-Kind');
    const userId = request.headers.get('X-Live-User');
    if ((kind !== 'staff' && kind !== 'student' && kind !== 'parent') || !userId) {
      return new Response('unauthorized', { status: 401 });
    }

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ kind, userId } satisfies SocketTag);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * The protocol is strictly server -> client. 'ping' never arrives here (the
   * auto-response pair handles it); anything else is ignored rather than
   * trusted.
   */
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // 1006 is "abnormal closure" and is not a valid code to send back.
    try {
      ws.close(code === 1006 ? 1000 : code, 'bye');
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      // Already closed.
    }
  }
}

/**
 * Handle the /ws upgrade. Called from workers/app.ts *before* the React Router
 * request handler: a 101 response carrying a `webSocket` must reach the runtime
 * untouched, and RR's handler is not a pass-through for it.
 *
 * Auth is the ordinary `__mochi_session` cookie — the browser attaches it
 * automatically to a same-origin wss:// handshake. Note `userFromToken` rather
 * than `requireUser`: the latter throws redirects, which mean nothing to a
 * WebSocket client, so a plain 401 is returned instead.
 */
export async function handleLiveUpgrade(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('expected websocket upgrade', { status: 426 });
  }

  const rawToken = await sessionCookie.parse(request.headers.get('Cookie'));
  if (!rawToken || typeof rawToken !== 'string') {
    return new Response('unauthorized', { status: 401 });
  }
  const user = await userFromToken(createDb(env), rawToken);
  if (!user) return new Response('unauthorized', { status: 401 });

  const forwarded = new Request('https://live-hub.internal/connect', request);
  forwarded.headers.set('X-Live-Kind', user.kind);
  forwarded.headers.set('X-Live-User', user.user.id);

  const stub = env.LIVE_HUB.get(env.LIVE_HUB.idFromName('global'));
  return stub.fetch(forwarded);
}
