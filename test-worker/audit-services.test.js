import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import { auditALS, newRequestStore, hasCrudEntry } from '../server/services/audit';
import * as peopleSvc from '../server/services/people';
import * as eventsSvc from '../server/services/events';
import * as classesSvc from '../server/services/classes';
import * as subjectsSvc from '../server/services/subjects';

/**
 * Stage 2 (mutation capture): the priority services push precise create/update/delete entries
 * into the ambient store, with real before/after snapshots, cascade extras on delete, no-op
 * skipping, and a single event for a whole reorder. Against real D1 (miniflare), one auditALS
 * scope per test — mirrors how workers/app.ts scopes one per request.
 */

function db() {
  return new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
}

/** Run `fn` inside one auditALS scope; returns `{ store, result }` — never just one or the other. */
async function withStore(fn) {
  const store = newRequestStore(new Request('https://x/audit-services-test'));
  const result = await auditALS.run(store, fn);
  return { store, result };
}

describe('people.ts', () => {
  it('createStudent records a create entry with the assembled shape', async () => {
    const d = db();
    const { result: cls } = await withStore(() =>
      classesSvc.create(d, { name: `C ${crypto.randomUUID()}`, color: 'blue', studentIds: [] }),
    );

    const { store } = await withStore(() =>
      peopleSvc.createStudent(d, {
        name: 'Audit Student',
        email: `s${crypto.randomUUID()}@test.com`,
        color: 'green',
        classIds: [cls.id],
      }),
    );
    const entry = store.entries.find((e) => e.action === 'create' && e.entityType === 'student');
    expect(entry).toBeDefined();
    expect(entry.after.classIds).toEqual([cls.id]);
  });

  it('updateStudent records before/after and skips when nothing changed', async () => {
    const d = db();
    const { result: student } = await withStore(() =>
      peopleSvc.createStudent(d, {
        name: 'Before Name',
        email: `s${crypto.randomUUID()}@test.com`,
        color: 'blue',
        classIds: [],
      }),
    );

    const { store: changed } = await withStore(() =>
      peopleSvc.updateStudent(d, student.id, { name: 'After Name' }),
    );
    const updateEntry = changed.entries.find((e) => e.action === 'update');
    expect(updateEntry.before.name).toBe('Before Name');
    expect(updateEntry.after.name).toBe('After Name');

    // A patch that changes nothing must not produce an update row.
    const { store: noop } = await withStore(() =>
      peopleSvc.updateStudent(d, student.id, { name: 'After Name' }),
    );
    expect(noop.entries.some((e) => e.action === 'update')).toBe(false);
  });

  it('removeStudent folds cascaded classIds/parentIds into before_json', async () => {
    const d = db();
    const { result: cls } = await withStore(() =>
      classesSvc.create(d, { name: `C ${crypto.randomUUID()}`, color: 'blue', studentIds: [] }),
    );
    const { result: student } = await withStore(() =>
      peopleSvc.createStudent(d, {
        name: 'Doomed',
        email: `s${crypto.randomUUID()}@test.com`,
        color: 'blue',
        classIds: [cls.id],
      }),
    );

    const { store } = await withStore(() => peopleSvc.removeStudent(d, student.id));
    const entry = store.entries.find((e) => e.action === 'delete');
    expect(entry.before.classIds).toEqual([cls.id]);
    expect(entry.before.name).toBe('Doomed');
  });
});

describe('events.ts', () => {
  it('update() skips the audit row for a real no-op patch', async () => {
    const d = db();
    const { result: ev } = await withStore(() =>
      eventsSvc.create(d, {
        title: 'Audit Event',
        date: '2026-09-01',
        recurrence: 'none',
      }),
    );
    // An empty patch: every field undefined, so the service's own `set` stays empty.
    const { store } = await withStore(() => eventsSvc.update(d, ev.id, {}));
    expect(store.entries).toHaveLength(0);
  });

  it('remove() folds attached material ids into before_json', async () => {
    const d = db();
    const { result: ev } = await withStore(() =>
      eventsSvc.create(d, { title: 'With material', date: '2026-09-02', recurrence: 'none' }),
    );
    const { store } = await withStore(() => eventsSvc.remove(d, ev.id));
    const entry = store.entries.find((e) => e.action === 'delete');
    expect(entry).toBeDefined();
    expect(Array.isArray(entry.before.materialIds)).toBe(true);
  });
});

describe('config enum services: reorder is one event, not N', () => {
  it('subjects.reorder() records exactly one update entry with the id list in meta', async () => {
    const d = db();
    const { result: a } = await withStore(() =>
      subjectsSvc.create(d, { name: `S-A ${crypto.randomUUID()}`, active: true }),
    );
    const { result: b } = await withStore(() =>
      subjectsSvc.create(d, { name: `S-B ${crypto.randomUUID()}`, active: true }),
    );
    const { result: c } = await withStore(() =>
      subjectsSvc.create(d, { name: `S-C ${crypto.randomUUID()}`, active: true }),
    );

    const { store } = await withStore(() => subjectsSvc.reorder(d, [c.id, b.id, a.id]));
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0]).toMatchObject({ action: 'update', entityType: 'subject' });
    expect(store.entries[0].meta.reordered).toEqual([c.id, b.id, a.id]);
  });
});

describe('coarse-vs-precise dedupe, at the primitive the wrappers rely on', () => {
  it('hasCrudEntry() is true right after a service records precisely', async () => {
    const d = db();
    let sawCrudEntry = false;
    await withStore(async () => {
      await subjectsSvc.create(d, { name: `Dedupe ${crypto.randomUUID()}`, active: true });
      sawCrudEntry = hasCrudEntry();
    });
    expect(sawCrudEntry).toBe(true);
  });
});
