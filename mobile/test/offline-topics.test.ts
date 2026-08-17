import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `lib/offline-topics.ts` — the read path.
 *
 * The opposite of the outbox in every way that matters: this is a cache, so throwing it away
 * costs a student nothing worse than a re-download. That asymmetry is the design, and the tests
 * below hold it in place — corrupt data is DROPPED here, where the outbox would keep it.
 *
 * Real SQLite again, so the `ON CONFLICT` upsert is genuinely exercised.
 */

const topic = vi.fn();
vi.mock('../lib/endpoints', () => ({ flashcards: { topic: (slug: string) => topic(slug) } }));

beforeEach(() => {
  vi.resetModules();
  topic.mockReset();
});

async function load() {
  const mod = await import('../lib/offline-topics');
  const { getDb } = await import('../lib/db');
  return { ...mod, getDb };
}

const SYNCED = '2026-01-01T00:00:00.000Z';

/** A TopicBundle, trimmed to the fields this module actually reads. */
const bundle = (id: string, slug: string, words = 3) =>
  ({
    topic: { id, slug, title: `Topic ${id}` },
    words: Array.from({ length: words }, (_, i) => ({ id: `w${i}`, term: `word ${i}` })),
  }) as never;

describe('saveTopic / readTopic', () => {
  it('round-trips a bundle byte for byte', async () => {
    const { saveTopic, readTopic } = await load();
    const b = bundle('t1', 'animals');

    await saveTopic(b, SYNCED);

    expect(await readTopic('animals')).toEqual({ bundle: b, syncedAt: SYNCED });
  });

  it('returns null for a topic that was never downloaded', async () => {
    const { readTopic } = await load();
    expect(await readTopic('never-downloaded')).toBeNull();
  });

  it('replaces the stored copy instead of accumulating rows', async () => {
    const { saveTopic, readTopic, listDownloaded } = await load();
    await saveTopic(bundle('t1', 'animals', 3), SYNCED);
    await saveTopic(bundle('t1', 'animals', 9), '2026-02-02T00:00:00.000Z');

    expect(await listDownloaded()).toHaveLength(1);
    const stored = await readTopic('animals');
    expect(stored!.bundle.words).toHaveLength(9);
    expect(stored!.syncedAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('follows a topic that was renamed to a new slug', async () => {
    const { saveTopic, readTopic } = await load();
    await saveTopic(bundle('t1', 'animals'), SYNCED);
    await saveTopic(bundle('t1', 'creatures'), SYNCED);

    expect(await readTopic('creatures')).not.toBeNull();
    expect(await readTopic('animals')).toBeNull();
  });

  it('falls back to the topic id when the bundle carries no slug', async () => {
    const { saveTopic, readTopic } = await load();
    await saveTopic({ topic: { id: 't9' }, words: [] } as never, SYNCED);
    expect(await readTopic('t9')).not.toBeNull();
  });
});

describe('corrupt storage', () => {
  it('drops a corrupt row so the next open re-downloads cleanly', async () => {
    const { saveTopic, readTopic, listDownloaded, getDb } = await load();
    await saveTopic(bundle('t1', 'animals'), SYNCED);
    const db = await getDb();
    await db.runAsync("UPDATE offline_topics SET payload = '{not json' WHERE slug = ?", 'animals');

    expect(await readTopic('animals')).toBeNull();
    expect(await listDownloaded()).toHaveLength(0);
  });
});

describe('listDownloaded / removeTopic', () => {
  it('reports what is downloaded and when each was refreshed', async () => {
    const { saveTopic, listDownloaded } = await load();
    await saveTopic(bundle('t1', 'animals'), SYNCED);
    await saveTopic(bundle('t2', 'colours'), '2026-03-03T00:00:00.000Z');

    expect(await listDownloaded()).toEqual([
      { topicId: 't1', slug: 'animals', syncedAt: SYNCED },
      { topicId: 't2', slug: 'colours', syncedAt: '2026-03-03T00:00:00.000Z' },
    ]);
  });

  it('removes one topic and leaves the rest alone', async () => {
    const { saveTopic, removeTopic, listDownloaded } = await load();
    await saveTopic(bundle('t1', 'animals'), SYNCED);
    await saveTopic(bundle('t2', 'colours'), SYNCED);

    await removeTopic('t1');

    expect((await listDownloaded()).map((m) => m.topicId)).toEqual(['t2']);
  });
});

describe('downloadTopic / refreshDownloaded', () => {
  it('stores what it fetched, stamped with the caller-supplied time', async () => {
    const { downloadTopic, readTopic } = await load();
    topic.mockResolvedValueOnce(bundle('t1', 'animals'));

    await downloadTopic('animals', new Date(SYNCED));

    expect(topic).toHaveBeenCalledWith('animals');
    expect((await readTopic('animals'))!.syncedAt).toBe(SYNCED);
  });

  it('refreshes every downloaded topic', async () => {
    const { saveTopic, refreshDownloaded } = await load();
    await saveTopic(bundle('t1', 'animals'), SYNCED);
    await saveTopic(bundle('t2', 'colours'), SYNCED);
    topic.mockResolvedValue(bundle('t1', 'animals'));

    expect(await refreshDownloaded(new Date(SYNCED))).toBe(2);
  });

  it('keeps the stored copy when a refresh fails, and refreshes the others anyway', async () => {
    const { saveTopic, refreshDownloaded, readTopic } = await load();
    await saveTopic(bundle('t1', 'animals', 3), SYNCED);
    await saveTopic(bundle('t2', 'colours', 3), SYNCED);
    topic.mockRejectedValueOnce(new Error('offline'));
    topic.mockResolvedValueOnce(bundle('t2', 'colours', 7));

    // One of the two succeeded — a partial refresh beats an all-or-nothing one.
    expect(await refreshDownloaded(new Date('2026-04-04T00:00:00.000Z'))).toBe(1);

    const kept = await readTopic('animals');
    expect(kept!.bundle.words).toHaveLength(3);
    expect(kept!.syncedAt).toBe(SYNCED);
  });
});
