import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingResult } from '../lib/outbox';

/**
 * `lib/outbox.ts` — the offline write queue.
 *
 * The module states its own contract: **delete a row only on a confirmed 2xx.** Both ways of
 * breaking it are silent and land on a student:
 *
 *   - delete too eagerly (on a timeout, say) and a finished round is gone, with nothing to
 *     notice and no way to redo it;
 *   - never delete and the queue wedges, retrying one poisoned row forever.
 *
 * Only the network seam is mocked. Everything under it is real: `lib/db.ts` applies its real
 * schema to a real SQLite database (`node:sqlite`, via the `expo-sqlite` stub), so a wrong
 * WHERE clause or a wrong column fails here rather than on a phone.
 */

const recordResults = vi.fn();
vi.mock('../lib/endpoints', () => ({
  flashcards: { recordResults: (input: unknown) => recordResults(input) },
}));

/** `db.ts` caches its connection for the process, so each test needs a fresh module registry. */
beforeEach(() => {
  vi.resetModules();
  recordResults.mockReset();
});

async function load() {
  const outbox = await import('../lib/outbox');
  const { getDb } = await import('../lib/db');
  return { ...outbox, getDb };
}

const NOW = new Date('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);

const round = (over: Partial<PendingResult> = {}): PendingResult =>
  ({
    topicId: 'topic-1',
    mode: 'flip',
    score: 8,
    total: 10,
    durationMs: 42_000,
    answers: [{ wordId: 'w1', correct: true }],
    ...over,
  }) as PendingResult;

/** The rows still queued, oldest first. */
async function queued(getDb: Awaited<ReturnType<typeof load>>['getDb']) {
  const db = await getDb();
  return db.getAllAsync<{ client_id: string; attempts: number; next_try_at: string | null }>(
    'SELECT client_id, attempts, next_try_at FROM outbox ORDER BY created_at',
  );
}

describe('enqueue', () => {
  it('stores the round with a generated clientId and no attempts yet', async () => {
    const { enqueue, getDb } = await load();

    const clientId = await enqueue(round(), NOW);

    expect(clientId).toBe('uuid-1');
    const rows = await queued(getDb);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_id: 'uuid-1', attempts: 0, next_try_at: null });
  });

  it('puts the clientId inside the stored payload, since that is what the server keys on', async () => {
    const { enqueue, getDb } = await load();
    await enqueue(round(), NOW);

    const db = await getDb();
    const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM outbox');
    expect(JSON.parse(row!.payload)).toMatchObject({ clientId: 'uuid-1', topicId: 'topic-1' });
  });

  it('counts what is waiting, for the "n waiting to sync" indicator', async () => {
    const { enqueue, pendingCount } = await load();
    expect(await pendingCount()).toBe(0);
    await enqueue(round(), NOW);
    await enqueue(round(), NOW);
    expect(await pendingCount()).toBe(2);
  });
});

describe('flush: the success path', () => {
  it('deletes the rows and reports what the server did', async () => {
    const { enqueue, flush, getDb } = await load();
    await enqueue(round(), NOW);
    await enqueue(round(), NOW);
    recordResults.mockResolvedValueOnce({ received: 2, recorded: 1, duplicates: 1, outcomes: [] });

    const out = await flush(NOW);

    expect(out).toMatchObject({ sent: 2, recorded: 1, duplicates: 1, remaining: 0 });
    expect(await queued(getDb)).toHaveLength(0);
  });

  it('sends every queued payload in one batch', async () => {
    const { enqueue, flush } = await load();
    await enqueue(round({ topicId: 'a' }), NOW);
    await enqueue(round({ topicId: 'b' }), NOW);
    recordResults.mockResolvedValueOnce({ recorded: 2, duplicates: 0, outcomes: [] });

    await flush(NOW);

    expect(recordResults).toHaveBeenCalledTimes(1);
    const [{ results }] = recordResults.mock.calls[0] as [{ results: { topicId: string }[] }];
    expect(results.map((r) => r.topicId)).toEqual(['a', 'b']);
  });

  it('drops outcomes the server could not match back to a device round', async () => {
    const { enqueue, flush } = await load();
    await enqueue(round(), NOW);
    recordResults.mockResolvedValueOnce({
      recorded: 1,
      duplicates: 0,
      outcomes: [
        { clientId: 'uuid-1', garden: { grew: true } },
        { clientId: null, garden: null },
      ],
    });

    const out = await flush(NOW);

    expect(out.outcomes).toEqual([{ clientId: 'uuid-1', garden: { grew: true } }]);
  });

  it('tolerates a server too old to report outcomes at all', async () => {
    // An OTA update can reach a phone minutes before the Worker deploy that added the field.
    const { enqueue, flush } = await load();
    await enqueue(round(), NOW);
    recordResults.mockResolvedValueOnce({ recorded: 1, duplicates: 0 });

    const out = await flush(NOW);

    expect(out.sent).toBe(1);
    expect(out.outcomes).toEqual([]);
  });

  it('does nothing, and says so, when the queue is empty', async () => {
    const { flush } = await load();
    const out = await flush(NOW);
    expect(out).toMatchObject({ sent: 0, recorded: 0, duplicates: 0, remaining: 0 });
    expect(recordResults).not.toHaveBeenCalled();
  });
});

describe('flush: failures keep the work', () => {
  it('KEEPS the row when the network fails, and backs off 30s', async () => {
    const { enqueue, flush, getDb } = await load();
    await enqueue(round(), NOW);
    recordResults.mockRejectedValueOnce(new Error('offline'));

    const out = await flush(NOW);

    expect(out).toMatchObject({ sent: 0, remaining: 1, error: 'err_generic_msg' });
    const rows = await queued(getDb);
    expect(rows[0]).toMatchObject({ attempts: 1, next_try_at: '2026-01-01T00:00:30.000Z' });
  });

  it('keeps the row on a 401 — a signed-out user still finished that round', async () => {
    const { enqueue, flush, getDb } = await load();
    const { ApiError } = await import('../lib/api');
    await enqueue(round(), NOW);
    recordResults.mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'm_session_expired'));

    const out = await flush(NOW);

    expect(out).toMatchObject({ sent: 0, remaining: 1, error: 'm_session_expired' });
    expect(await queued(getDb)).toHaveLength(1);
  });

  it('keeps the row on a 5xx', async () => {
    const { enqueue, flush, getDb } = await load();
    const { ApiError } = await import('../lib/api');
    await enqueue(round(), NOW);
    recordResults.mockRejectedValueOnce(new ApiError(503, 'unavailable', 'm_server_error'));

    await flush(NOW);

    expect(await queued(getDb)).toHaveLength(1);
  });

  it('walks the backoff ladder and then holds at hourly', async () => {
    const { enqueue, flush, getDb } = await load();
    await enqueue(round(), NOW);

    // 30s, 2m, 8m, 32m, then 1h for every attempt after.
    const ladder = [30_000, 120_000, 480_000, 1_920_000, 3_600_000, 3_600_000, 3_600_000];
    let clock = NOW;

    for (const [i, wait] of ladder.entries()) {
      recordResults.mockRejectedValueOnce(new Error('offline'));
      await flush(clock);

      const rows = await queued(getDb);
      expect(rows[0].attempts).toBe(i + 1);
      expect(rows[0].next_try_at).toBe(new Date(clock.getTime() + wait).toISOString());

      // Jump to the moment the row becomes due again.
      clock = new Date(clock.getTime() + wait);
    }
  });

  it('leaves a row alone until its backoff has elapsed', async () => {
    const { enqueue, flush } = await load();
    await enqueue(round(), NOW);
    recordResults.mockRejectedValueOnce(new Error('offline'));
    await flush(NOW);
    recordResults.mockReset();

    // One second early: still not due.
    const early = await flush(at(29_000));
    expect(recordResults).not.toHaveBeenCalled();
    expect(early).toMatchObject({ sent: 0, remaining: 1 });

    // Due now.
    recordResults.mockResolvedValueOnce({ recorded: 1, duplicates: 0, outcomes: [] });
    const due = await flush(at(30_000));
    expect(due.sent).toBe(1);
  });
});

describe('flush: rows that can never succeed', () => {
  it('drops the batch on a 422, which no amount of retrying would fix', async () => {
    const { enqueue, flush, getDb } = await load();
    const { ApiError } = await import('../lib/api');
    await enqueue(round(), NOW);
    recordResults.mockRejectedValueOnce(new ApiError(422, 'validation_failed', 'err_generic_msg'));

    const out = await flush(NOW);

    expect(out).toMatchObject({ sent: 0, remaining: 0 });
    expect(await queued(getDb)).toHaveLength(0);
  });

  it('drops a corrupt row rather than letting it wedge the queue behind it', async () => {
    const { enqueue, flush, getDb } = await load();
    await enqueue(round(), NOW);
    const db = await getDb();
    await db.runAsync("UPDATE outbox SET payload = '{not json' WHERE client_id = ?", 'uuid-1');

    const out = await flush(NOW);

    expect(recordResults).not.toHaveBeenCalled();
    expect(out).toMatchObject({ sent: 0, remaining: 0 });
    expect(await queued(getDb)).toHaveLength(0);
  });

  it('still sends the healthy rows sitting alongside a corrupt one', async () => {
    const { enqueue, flush, getDb } = await load();
    await enqueue(round({ topicId: 'bad' }), NOW);
    await enqueue(round({ topicId: 'good' }), NOW);
    const db = await getDb();
    await db.runAsync("UPDATE outbox SET payload = '{not json' WHERE client_id = ?", 'uuid-1');
    recordResults.mockResolvedValueOnce({ recorded: 1, duplicates: 0, outcomes: [] });

    const out = await flush(NOW);

    const [{ results }] = recordResults.mock.calls[0] as [{ results: { topicId: string }[] }];
    expect(results.map((r) => r.topicId)).toEqual(['good']);
    expect(out).toMatchObject({ sent: 1, remaining: 0 });
    expect(await queued(getDb)).toHaveLength(0);
  });
});

describe('flush: batching', () => {
  it('never sends more than the server accepts in one batch', async () => {
    const { enqueue, flush, getDb } = await load();
    for (let i = 0; i < 55; i++) await enqueue(round({ topicId: `t${i}` }), NOW);
    recordResults.mockResolvedValueOnce({ recorded: 50, duplicates: 0, outcomes: [] });

    const out = await flush(NOW);

    const [{ results }] = recordResults.mock.calls[0] as [{ results: unknown[] }];
    expect(results).toHaveLength(50); // FlashcardResultBatch caps at 50
    expect(out).toMatchObject({ sent: 50, remaining: 5 });
    expect(await queued(getDb)).toHaveLength(5);
  });
});
