import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as classesSvc from '../server/services/classes';
import * as eventsSvc from '../server/services/events';
import * as peopleSvc from '../server/services/people';
import * as zalo from '../server/services/zalo';
import { setSchoolNotifPrefs } from '../server/services/notif-prefs';
import { runClassReminders } from '../server/services/notify';
import { zaloChats, zaloPairCodes } from '../server/db/schema';

/**
 * The Zalo channel: pairing, targeting, and the cron fan-out.
 *
 * The Bot API is stubbed. What is asserted here is what the code DECIDES — who a message is
 * addressed to, and whether it is sent twice — because those are the parts that can be wrong in
 * ways nobody notices until a parent is either spammed or silently never told anything.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

/** A configured channel. Absent ZALO_BOT_TOKEN, every send no-ops by design. */
const ON = { ZALO_BOT_TOKEN: '123:abc', ZALO_WEBHOOK_SECRET: 'test-secret-value' };

/** Every payload handed to the Bot API since the last reset, as {method, body}. */
let calls = [];

beforeEach(async () => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 'm1' } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  const d = db();
  await d.raw.delete(zaloChats);
  await d.raw.delete(zaloPairCodes);
});

// The service functions take already-parsed Zod input, so the collection fields are required
// rather than optional. These keep that noise out of the tests.
const mkParent = (d, name, studentIds = []) =>
  peopleSvc.createParent(d, { name, color: 'green', studentIds });
const mkStudent = (d, name) => peopleSvc.createStudent(d, { name, color: 'blue', classIds: [] });
const mkClass = (d, name, studentIds = []) =>
  classesSvc.create(d, { name, color: 'green', studentIds });

/** Messages sent, as plain text. */
function textsSent() {
  return calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text);
}

function chatsMessaged() {
  return calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.chat_id);
}

describe('pairing codes', () => {
  it('links a chat to a parent and burns the code', async () => {
    const d = db();
    const parent = await mkParent(d, 'Mẹ Linh');
    const { code } = await zalo.createPairCode(d, { parentId: parent.id });

    const outcome = await zalo.redeemCode(d.raw, code, { chatId: 'chat-1', kind: 'user' });
    expect(outcome).toBe('ok');

    const links = await zalo.listLinks(d);
    expect(links).toHaveLength(1);
    expect(links[0].parentId).toBe(parent.id);
    expect(links[0].chatId).toBe('chat-1');

    // Single use. A code that kept working would let anyone who saw it over a parent's shoulder
    // attach their own Zalo to that parent's notifications.
    expect(await zalo.redeemCode(d.raw, code, { chatId: 'chat-2', kind: 'user' })).toBe('used');
  });

  it('accepts the code in any of the shapes people actually send it', async () => {
    const d = db();
    const parent = await mkParent(d, 'Bố Nam');

    for (const shape of [(c) => c, (c) => c.toLowerCase(), (c) => `/start ${c}`, (c) => ` ${c} `]) {
      const { code } = await zalo.createPairCode(d, { parentId: parent.id });
      await zalo.handleUpdate(d.raw, ON, {
        message: {
          text: shape(code),
          chat: { id: 'chat-shapes', chat_type: 'PRIVATE' },
          from: { display_name: 'Bố Nam' },
        },
      });
      const links = await zalo.listLinks(d);
      expect(links.map((l) => l.chatId)).toContain('chat-shapes');
      await d.raw.delete(zaloChats);
    }
  });

  it('rejects an expired code', async () => {
    const d = db();
    const parent = await mkParent(d, 'Mẹ Hoa');
    const { code } = await zalo.createPairCode(d, { parentId: parent.id });
    await d.raw
      .update(zaloPairCodes)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(zaloPairCodes.code, code));

    expect(await zalo.redeemCode(d.raw, code, { chatId: 'chat-x', kind: 'user' })).toBe('expired');
    expect(await zalo.listLinks(d)).toHaveLength(0);
  });

  it('rejects an unknown code without linking anything', async () => {
    expect(await zalo.redeemCode(db().raw, 'ZZZZZZ', { chatId: 'c', kind: 'user' })).toBe(
      'unknown',
    );
    expect(await zalo.listLinks(db())).toHaveLength(0);
  });

  /**
   * The privacy case. A personal code redeemed in a group would send that family's fee slips to
   * the whole class; a class code redeemed privately would quietly make one person's chat the
   * destination for everything meant for the group.
   */
  it('refuses a personal code in a group and a class code in a private chat', async () => {
    const d = db();
    const parent = await mkParent(d, 'Mẹ An');
    const cls = await mkClass(d, 'Toán 9A');

    const personal = await zalo.createPairCode(d, { parentId: parent.id });
    expect(await zalo.redeemCode(d.raw, personal.code, { chatId: 'g1', kind: 'group' })).toBe(
      'wrong_context',
    );

    const group = await zalo.createPairCode(d, { classId: cls.id });
    expect(await zalo.redeemCode(d.raw, group.code, { chatId: 'p1', kind: 'user' })).toBe(
      'wrong_context',
    );

    expect(await zalo.listLinks(d)).toHaveLength(0);
  });

  /**
   * Re-pairing MOVES a chat. Without the upsert, the old row survives and keeps delivering the
   * first parent's notifications to a conversation that now belongs to someone else — a leak
   * nobody can see, because nothing in the UI shows two rows for one chat.
   */
  it('moves a chat when it is paired again to somebody else', async () => {
    const d = db();
    const a = await mkParent(d, 'Parent A');
    const b = await mkParent(d, 'Parent B');

    const first = await zalo.createPairCode(d, { parentId: a.id });
    await zalo.redeemCode(d.raw, first.code, { chatId: 'shared-chat', kind: 'user' });
    const second = await zalo.createPairCode(d, { parentId: b.id });
    await zalo.redeemCode(d.raw, second.code, { chatId: 'shared-chat', kind: 'user' });

    const links = await zalo.listLinks(d);
    expect(links).toHaveLength(1);
    expect(links[0].parentId).toBe(b.id);
  });

  it('unlinks on /unlink', async () => {
    const d = db();
    const parent = await mkParent(d, 'Mẹ Thu');
    const { code } = await zalo.createPairCode(d, { parentId: parent.id });
    await zalo.redeemCode(d.raw, code, { chatId: 'chat-bye', kind: 'user' });

    await zalo.handleUpdate(d.raw, ON, {
      message: { text: '/unlink', chat: { id: 'chat-bye', chat_type: 'PRIVATE' } },
    });
    expect(await zalo.listLinks(d)).toHaveLength(0);
  });

  /** A bot that answers every message in a class group is a bot that gets removed from it. */
  it('stays silent on unrecognised text in a group, but helps in a private chat', async () => {
    const d = db();
    await zalo.handleUpdate(d.raw, ON, {
      message: { text: 'ai học bài chưa', chat: { id: 'g9', chat_type: 'GROUP' } },
    });
    expect(textsSent()).toHaveLength(0);

    await zalo.handleUpdate(d.raw, ON, {
      message: { text: 'xin chào', chat: { id: 'p9', chat_type: 'PRIVATE' } },
    });
    expect(textsSent()).toHaveLength(1);
  });

  /**
   * Verified against the live platform: Zalo delivers a group message only when the bot is
   * @mentioned, and leaves the mention in the text — `"@Bot Mochi dev /link ABC234"`. Anchoring
   * the command at the start of the message therefore worked everywhere except the one place
   * `/link` is actually used, and failed silently.
   */
  it('links a group when the command follows an @mention', async () => {
    const d = db();
    const cls = await mkClass(d, 'Toán 9A');
    const { code } = await zalo.createPairCode(d, { classId: cls.id });

    await zalo.handleUpdate(d.raw, ON, {
      message: {
        text: `@Bot Mochi dev /link ${code}`,
        chat: { id: 'zgr-real', chat_type: 'GROUP' },
        from: { display_name: 'Nguyen Quang Vu' },
      },
    });

    expect(await zalo.chatForClass(d, cls.id)).toBe('zgr-real');
  });

  /**
   * The other half of that rule. A group is full of ordinary conversation, so a bare code — even
   * a real one — must not link anything there; only an explicit /link does.
   */
  it('ignores a bare code in a group but accepts one in a private chat', async () => {
    const d = db();
    const cls = await mkClass(d, 'Lý 10');
    const first = await zalo.createPairCode(d, { classId: cls.id });

    await zalo.handleUpdate(d.raw, ON, {
      message: { text: `@Bot Mochi dev ${first.code}`, chat: { id: 'g-bare', chat_type: 'GROUP' } },
    });
    expect(await zalo.listLinks(d)).toHaveLength(0);
    expect(textsSent()).toHaveLength(0);

    const parent = await mkParent(d, 'Mẹ Bare');
    const second = await zalo.createPairCode(d, { parentId: parent.id });
    await zalo.handleUpdate(d.raw, ON, {
      message: { text: second.code, chat: { id: 'p-bare', chat_type: 'PRIVATE' } },
    });
    expect(await zalo.listLinks(d)).toHaveLength(1);
  });

  /** An explicit request gets an answer even in a group — the silence rule is for everything else. */
  it('answers a /link with no usable code, even in a group', async () => {
    await zalo.handleUpdate(db().raw, ON, {
      message: { text: '@Bot Mochi dev /link', chat: { id: 'g-empty', chat_type: 'GROUP' } },
    });
    expect(textsSent()).toHaveLength(1);
  });

  it('unlinks a group when /unlink follows an @mention', async () => {
    const d = db();
    const cls = await mkClass(d, 'Hóa 11');
    const { code } = await zalo.createPairCode(d, { classId: cls.id });
    await zalo.redeemCode(d.raw, code, { chatId: 'g-bye', kind: 'group' });

    await zalo.handleUpdate(d.raw, ON, {
      message: { text: '@Bot Mochi dev /unlink', chat: { id: 'g-bye', chat_type: 'GROUP' } },
    });
    expect(await zalo.chatForClass(d, cls.id)).toBeNull();
  });
});

describe('the polling relay', () => {
  /**
   * Zalo's webhook cannot reach this app on *.workers.dev — Cloudflare answers its
   * `Java/1.8.0_192` agent with error 1010 at the edge (see workers/zalo-poller.ts). The poller
   * replaces it by pulling instead, so what matters is that a polled update travels the same
   * road a webhook delivery would: through `handleUpdate`, into the database.
   */
  it('turns a polled update into a real pairing', async () => {
    const d = db();
    const parent = await mkParent(d, 'Mẹ Poll');
    const { code } = await zalo.createPairCode(d, { parentId: parent.id });

    // Exactly the shape getUpdates answers with: the `{ ok, result }` envelope, unlike the
    // webhook's bare body — the difference that silently broke this once already.
    const update = zalo.unwrapUpdate({
      ok: true,
      result: {
        event_name: 'message.text.received',
        message: {
          text: code,
          chat: { id: 'polled-chat', chat_type: 'PRIVATE' },
          from: { id: 'polled-chat', is_bot: false, display_name: 'Mẹ Poll' },
        },
      },
    });
    await zalo.handleUpdate(d.raw, ON, update);

    const links = await zalo.listLinks(d);
    expect(links).toHaveLength(1);
    expect(links[0].chatId).toBe('polled-chat');
    expect(links[0].parentId).toBe(parent.id);
  });

  /** A 408 is Zalo saying "nothing arrived in 25 seconds" — routine, never an error. */
  it('treats an empty long-poll as normal', async () => {
    const res = zalo.unwrapUpdate({ ok: false, description: 'Request timeout', error_code: 408 });
    expect(res).toBeNull();
  });
});

describe('the webhook envelope', () => {
  /**
   * Regression, found in production after a day of chasing it. Zalo's webhook POSTs the update
   * BARE; only `getUpdates` wraps it in `{ ok, result }`. Parsing for `result` alone meant every
   * real delivery was answered 200 and dropped — a silent success that looks exactly like Zalo
   * never delivering, which is what made it so expensive to find.
   */
  it('reads the bare shape Zalo actually POSTs', () => {
    const bare = {
      event_name: 'message.text.received',
      message: {
        text: 'hi',
        chat: { id: 'fcb337f675ba9ce4c5ab', chat_type: 'PRIVATE' },
        from: { id: 'fcb337f675ba9ce4c5ab', is_bot: false, display_name: 'Vu' },
      },
    };
    expect(zalo.unwrapUpdate(bare)?.message?.text).toBe('hi');
  });

  it('still reads the { ok, result } shape the poll script replays', () => {
    const wrapped = {
      ok: true,
      result: { event_name: 'message.text.received', message: { text: 'hi', chat: { id: 'c' } } },
    };
    expect(zalo.unwrapUpdate(wrapped)?.message?.text).toBe('hi');
  });

  it('returns null for anything else rather than guessing', () => {
    for (const junk of [null, undefined, 'string', 42, {}, { ok: true }]) {
      expect(zalo.unwrapUpdate(junk)).toBeNull();
    }
  });
});

describe('the bot token', () => {
  /**
   * Regression, found in production. `wrangler secret put` fed from a pipe keeps the trailing
   * newline, and the token goes into the URL PATH — so one invisible character turned every
   * send into `Not Found` 404, which looks exactly like a routing bug. Zalo answers a genuinely
   * wrong token with 401 instead; that is the only way to tell them apart from the outside.
   */
  it('survives a token stored with surrounding whitespace', async () => {
    const messy = { ZALO_BOT_TOKEN: '  123:abc\n' };
    expect(zalo.isEnabled(messy)).toBe(true);

    await zalo.sendText(messy, 'chat-1', 'hello');
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toBe('https://bot-api.zaloplatforms.com/bot123:abc/sendMessage');
    expect(url).not.toMatch(/\s/);
  });

  it('treats a whitespace-only token as no token at all', () => {
    expect(zalo.isEnabled({ ZALO_BOT_TOKEN: '   \n' })).toBe(false);
    expect(zalo.isEnabled({})).toBe(false);
  });
});

describe('share-card media', () => {
  /**
   * The images are served from a capability URL — unguessable, but permanent unless something
   * removes them. Pruning is what turns "hard to find" into "stops working".
   */
  it('deletes share cards older than the window and keeps fresh ones', async () => {
    const fresh = `zalo/${crypto.randomUUID()}.png`;
    const stale = `zalo/${crypto.randomUUID()}.png`;
    await env.FILES.put(fresh, 'x');
    await env.FILES.put(stale, 'x');

    // Nothing is old enough yet, so a prune with the real window must not touch either.
    expect(await zalo.pruneMedia(env.FILES, 7)).toBe(0);
    expect(await env.FILES.get(fresh)).not.toBeNull();

    // A zero-day window makes everything stale — the same code path, without waiting a week.
    expect(await zalo.pruneMedia(env.FILES, 0)).toBeGreaterThanOrEqual(2);
    expect(await env.FILES.get(fresh)).toBeNull();
    expect(await env.FILES.get(stale)).toBeNull();
  });

  /** Only the `zalo/` prefix is swept: materials live in the same bucket. */
  it('never touches objects outside the zalo/ prefix', async () => {
    const material = `materials/${crypto.randomUUID()}.pdf`;
    await env.FILES.put(material, 'x');
    await zalo.pruneMedia(env.FILES, 0);
    expect(await env.FILES.get(material)).not.toBeNull();
    await env.FILES.delete(material);
  });
});

describe('targeting', () => {
  it('finds the chats of every parent of a set of students, without duplicates', async () => {
    const d = db();
    const s1 = await mkStudent(d, 'Linh');
    const s2 = await mkStudent(d, 'Nam');
    // One parent, two children in the same class — the sibling case that produces a duplicate.
    const parent = await mkParent(d, 'Mẹ', [s1.id, s2.id]);

    const { code } = await zalo.createPairCode(d, { parentId: parent.id });
    await zalo.redeemCode(d.raw, code, { chatId: 'chat-mum', kind: 'user' });

    const chats = await zalo.chatsForParentsOfStudents(d, [s1.id, s2.id]);
    expect(chats).toEqual(['chat-mum']);
  });

  /**
   * Most students have no `parents` row — those are typed in by hand — so a family paired
   * straight to the student must reach the same fan-out. See migrations/0028.
   */
  it('reaches a family paired to the student, with no parent record at all', async () => {
    const d = db();
    const student = await mkStudent(d, 'Không có phụ huynh');
    const { code } = await zalo.createPairCode(d, { studentId: student.id });
    expect(await zalo.redeemCode(d.raw, code, { chatId: 'chat-guardian', kind: 'user' })).toBe(
      'ok',
    );

    expect(await zalo.chatsForParentsOfStudents(d, [student.id])).toEqual(['chat-guardian']);
    expect((await zalo.listLinks(d))[0].studentId).toBe(student.id);
  });

  /** Both routes at once must not message the same family twice. */
  it('dedupes a family paired by both routes', async () => {
    const d = db();
    const student = await mkStudent(d, 'Cả hai');
    const parent = await mkParent(d, 'Mẹ Cả hai', [student.id]);

    const viaParent = await zalo.createPairCode(d, { parentId: parent.id });
    await zalo.redeemCode(d.raw, viaParent.code, { chatId: 'same-chat', kind: 'user' });
    const viaStudent = await zalo.createPairCode(d, { studentId: student.id });
    await zalo.redeemCode(d.raw, viaStudent.code, { chatId: 'same-chat', kind: 'user' });

    expect(await zalo.chatsForParentsOfStudents(d, [student.id])).toEqual(['same-chat']);
  });

  /**
   * Money goes to an adult. A student link is whoever redeemed that student's code — possibly
   * the student — so the fee slip asks for parent records only and would rather send nothing.
   */
  it('excludes a student-paired chat from the parent-only route', async () => {
    const d = db();
    const student = await mkStudent(d, 'Chỉ học sinh');
    const viaStudent = await zalo.createPairCode(d, { studentId: student.id });
    await zalo.redeemCode(d.raw, viaStudent.code, { chatId: 'the-teenager', kind: 'user' });

    // The reminder route finds them; the fee-slip route deliberately does not.
    expect(await zalo.chatsForParentsOfStudents(d, [student.id])).toEqual(['the-teenager']);
    expect(await zalo.chatsForParentRecordsOf(d, [student.id])).toEqual([]);

    const parent = await mkParent(d, 'Mẹ thật', [student.id]);
    const viaParent = await zalo.createPairCode(d, { parentId: parent.id });
    await zalo.redeemCode(d.raw, viaParent.code, { chatId: 'the-parent', kind: 'user' });
    expect(await zalo.chatsForParentRecordsOf(d, [student.id])).toEqual(['the-parent']);
  });

  /** A student code is a private-chat code, exactly like a parent one. */
  it('refuses a student code sent in a group', async () => {
    const d = db();
    const student = await mkStudent(d, 'Nhóm sai');
    const { code } = await zalo.createPairCode(d, { studentId: student.id });
    expect(await zalo.redeemCode(d.raw, code, { chatId: 'g-x', kind: 'group' })).toBe(
      'wrong_context',
    );
    expect(await zalo.listLinks(d)).toHaveLength(0);
  });

  it('finds the group chat linked to a class', async () => {
    const d = db();
    const cls = await mkClass(d, 'Lý 10');
    const { code } = await zalo.createPairCode(d, { classId: cls.id });
    await zalo.redeemCode(d.raw, code, { chatId: 'group-ly10', kind: 'group' });

    expect(await zalo.chatForClass(d, cls.id)).toBe('group-ly10');
    expect(await zalo.chatForClass(d, 'no-such-class')).toBeNull();
  });
});

describe('class reminders over Zalo', () => {
  /**
   * A moment in UTC whose ICT (UTC+7) wall clock is `hh:mm` on `dateIso` — the same helper the
   * push tests use, because the job reasons entirely in Vietnam local time.
   */
  function utcForIct(dateIso, hh, mm) {
    return new Date(
      `${dateIso}T${String(hh - 7).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`,
    );
  }

  const DAY = '2026-08-03';

  /** A 09:00 class with one student whose parent has paired a Zalo chat. */
  async function seedUpcomingClass(d) {
    const student = await mkStudent(d, 'Linh');
    const parent = await mkParent(d, 'Mẹ Linh', [student.id]);
    const cls = await mkClass(d, 'Toán 9A', [student.id]);

    const { code } = await zalo.createPairCode(d, { parentId: parent.id });
    await zalo.redeemCode(d.raw, code, { chatId: 'chat-parent', kind: 'user' });

    await eventsSvc.create(d, {
      title: 'Buổi 3',
      date: DAY,
      start: '09:00',
      end: '10:00',
      classId: cls.id,
      recurrence: 'none',
    });
    // 08:40 ICT — twenty minutes out, inside the 30-minute lead window.
    return { at: utcForIct(DAY, 8, 40), cls };
  }

  it('messages the parent once, however many times the sweep runs', async () => {
    const d = db();
    await setSchoolNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const { at, cls } = await seedUpcomingClass(d);

    await runClassReminders(d, at, ON);
    expect(chatsMessaged()).toEqual(['chat-parent']);
    expect(textsSent()[0]).toContain(cls.name);

    // Three more ticks over the same window. The ledger is the only thing standing between a
    // parent and four identical messages about one class.
    calls = [];
    await runClassReminders(d, at, ON);
    await runClassReminders(d, at, ON);
    await runClassReminders(d, at, ON);
    expect(textsSent()).toHaveLength(0);
  });

  /**
   * The reason Zalo keeps its own ledger keys. Push runs first and marks the occurrence done
   * under `class:`; if Zalo shared that key, switching the channel on would find every
   * occurrence already handled and no parent would ever hear anything.
   */
  it('still messages parents for an occurrence push has already handled', async () => {
    const d = db();
    await setSchoolNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    const { at } = await seedUpcomingClass(d);

    // A push-only run: no env, so the Zalo pass is skipped entirely.
    await runClassReminders(d, at);
    expect(textsSent()).toHaveLength(0);

    calls = [];
    await runClassReminders(d, at, ON);
    expect(chatsMessaged()).toEqual(['chat-parent']);
  });

  it('sends nothing at all when the channel is unconfigured', async () => {
    const d = db();
    await setSchoolNotifPrefs(d, { classReminders: true, classLeadMinutes: 30 });
    await seedUpcomingClass(d).then(({ at }) => runClassReminders(d, at, {}));
    expect(calls).toHaveLength(0);
  });
});
