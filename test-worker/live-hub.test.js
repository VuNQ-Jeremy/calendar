import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as authSvc from '../server/services/auth';
import * as peopleSvc from '../server/services/people';
import { hashPassword } from '../server/services/crypto';
import { accounts } from '../server/db/schema';
import { sessionCookie } from '../server/session';

/**
 * The live-update hub (workers/live-hub.ts).
 *
 * Two things must hold: an unauthenticated client cannot open a socket at all,
 * and a student socket never receives staff-only domains.
 *
 * Upgrade auth is exercised end-to-end through SELF (worker/index.js routes /ws
 * to the real handleLiveUpgrade); fan-out is exercised against the Durable
 * Object directly, since driving two authenticated browser sockets through the
 * test worker buys nothing the direct stub does not already prove.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

async function seedStaffSession(email) {
  const d = db();
  const staffRow = await peopleSvc.createStaff(d, {
    name: 'Hub Staff',
    email,
    role: 'Teacher',
    color: 'orange',
  });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword('pw'),
    staffId: staffRow.id,
    createdAt: new Date().toISOString(),
  });
  return authSvc.createSession(d.raw, accountId, false);
}

/** A fresh hub per test, so sockets from earlier tests cannot skew delivered counts. */
function freshHub() {
  return env.LIVE_HUB.get(env.LIVE_HUB.idFromName(crypto.randomUUID()));
}

/**
 * Open a socket that records everything it receives from the moment it is
 * accepted. Recording rather than awaiting one message at a time matters: a
 * broadcast is delivered during the `await` on the POST, so a listener attached
 * afterwards would miss it — and "no message arrived" is exactly what the
 * filtering test needs to assert.
 */
async function openSocket(stub, kind, userId = crypto.randomUUID()) {
  const res = await stub.fetch('https://live-hub.internal/connect', {
    headers: { Upgrade: 'websocket', 'X-Live-Kind': kind, 'X-Live-User': userId },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  const received = [];
  ws.addEventListener('message', (ev) => {
    received.push(JSON.parse(ev.data));
  });
  ws.accept();

  return {
    received,
    /** Wait until at least `n` messages have arrived, else fail rather than hang. */
    async waitFor(n, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      while (received.length < n) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${n} message(s); got ${received.length}`);
        }
        await scheduler.wait(10);
      }
      return received;
    },
  };
}

function broadcast(stub, domain) {
  return stub.fetch('https://live-hub.internal/broadcast', {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

const upgrade = (headers = {}) =>
  SELF.fetch('https://example.com/ws', { headers: { Upgrade: 'websocket', ...headers } });

describe('/ws upgrade auth', () => {
  it('rejects a request with no session cookie', async () => {
    const res = await upgrade();
    expect(res.status).toBe(401);
  });

  it('rejects a well-formed cookie holding an unknown token', async () => {
    // Must go through sessionCookie.serialize — createCookie base64-encodes the
    // value, so a hand-written header would not even parse.
    const cookie = await sessionCookie.serialize('not-a-real-token');
    const res = await upgrade({ Cookie: cookie });
    expect(res.status).toBe(401);
  });

  it('rejects a non-websocket request', async () => {
    const res = await SELF.fetch('https://example.com/ws');
    expect(res.status).toBe(426);
  });

  it('upgrades a valid staff session', async () => {
    const token = await seedStaffSession('hub-upgrade@test.com');
    const res = await upgrade({ Cookie: await sessionCookie.serialize(token) });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
  });
});

describe('broadcast fan-out', () => {
  it('delivers to every connected staff socket', async () => {
    const stub = freshHub();
    const a = await openSocket(stub, 'staff');
    const b = await openSocket(stub, 'staff');

    const res = await broadcast(stub, 'calendar');
    expect(await res.json()).toEqual({ ok: true, delivered: 2 });

    for (const socket of [a, b]) {
      const [msg] = await socket.waitFor(1);
      expect(msg.type).toBe('invalidate');
      expect(msg.domain).toBe('calendar');
      expect(typeof msg.ts).toBe('number');
    }
  });

  it('withholds staff-only domains from student sockets', async () => {
    const stub = freshHub();
    const staff = await openSocket(stub, 'staff');
    const student = await openSocket(stub, 'student');

    const staffOnly = await broadcast(stub, 'people');
    expect(await staffOnly.json()).toEqual({ ok: true, delivered: 1 });
    await staff.waitFor(1);

    const shared = await broadcast(stub, 'tests');
    expect(await shared.json()).toEqual({ ok: true, delivered: 2 });
    await student.waitFor(1);

    // The student saw only the shared domain; 'people' never reached them.
    expect(student.received.map((m) => m.domain)).toEqual(['tests']);
    expect(staff.received.map((m) => m.domain)).toEqual(['people', 'tests']);
  });

  it('rejects an unknown domain', async () => {
    const res = await broadcast(freshHub(), 'nonsense');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_domain' });
  });

  it('refuses a connect that carries no identity headers', async () => {
    const res = await freshHub().fetch('https://live-hub.internal/connect', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(401);
  });
});
