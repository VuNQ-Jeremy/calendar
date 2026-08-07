import { randomUUID } from 'expo-crypto';
import { getDb } from './db';
import * as api from './endpoints';
import { ApiError } from './api';
import type { FlashcardResultInput } from '@mochi/shared/schemas';
import type { GardenOutcome } from '@mochi/shared/logic/garden';

/**
 * The write path: finished games queued locally, then pushed to the server.
 *
 * ## Why this is safe to retry blindly
 *
 * Every queued result carries a device-generated `clientId`, and
 * `flashcard_results.client_id` has a UNIQUE partial index (migration 0014). So the server
 * treats a repeat POST of the same result as a no-op — the whole write is skipped, mastery
 * increments included.
 *
 * That single fact is what makes this design tractable. The dangerous case on mobile is a flush
 * that SUCCEEDS on the server but drops on the way back: the client cannot tell it apart from a
 * failure. Without the key, retrying would double-count a student's score and silently inflate
 * their mastery; with it, the client never has to reason about whether a result "already went
 * through" — it just retries until it gets a 2xx.
 *
 * ## The rule
 *
 * **Delete a row only on a confirmed 2xx.** Never on a network error, never on a timeout, never
 * "probably". A deleted row is a lost result, and the student has no way to notice or redo it.
 */

/** Max per flush, matching `FlashcardResultBatch`'s server-side cap. */
const BATCH = 50;

/** Backoff per attempt: 30s, 2m, 8m, 32m, then hourly. Capped so a stuck row keeps trying. */
const BACKOFF_MS = [30_000, 120_000, 480_000, 1_920_000, 3_600_000];

interface Row {
  client_id: string;
  payload: string;
  created_at: string;
  attempts: number;
  next_try_at: string | null;
}

/** A finished game, minus the clientId — which this module generates. */
export type PendingResult = Omit<FlashcardResultInput, 'clientId'>;

/**
 * Queue a finished game. Returns the generated clientId.
 *
 * Call this BEFORE (or instead of) any network attempt, and show the student their score
 * immediately either way. Gameplay must never wait on connectivity, and a result that only
 * exists in flight is a result that can vanish.
 */
export async function enqueue(result: PendingResult, now: Date): Promise<string> {
  const clientId = randomUUID();
  const payload: FlashcardResultInput = { ...result, clientId };
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO outbox (client_id, payload, created_at, attempts) VALUES (?, ?, ?, 0)',
    clientId,
    JSON.stringify(payload),
    now.toISOString(),
  );
  return clientId;
}

/** How many results are waiting. Drives the "3 waiting to sync" indicator. */
export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
  return row?.n ?? 0;
}

function parse(row: Row): { clientId: string; payload: FlashcardResultInput } | null {
  try {
    return { clientId: row.client_id, payload: JSON.parse(row.payload) as FlashcardResultInput };
  } catch {
    return null;
  }
}

export interface FlushOutcome {
  sent: number;
  recorded: number;
  duplicates: number;
  /** Rows left in the queue afterwards — either not due yet, or they failed. */
  remaining: number;
  /**
   * What each flushed round did to the garden, keyed on the clientId `enqueue` returned. Present
   * only on a successful flush against a server new enough to report it — a caller that finds its
   * own round missing shows no note, which is the honest answer.
   *
   * Deliberately NOT correlated by position: a flush batches whatever is due, so the round the
   * student just finished may be third in the list.
   */
  outcomes?: { clientId: string; garden: GardenOutcome | null }[];
  error?: string;
}

/**
 * Push whatever is due. Safe to call concurrently-ish and safe to call when offline; it simply
 * reports what it did.
 *
 * Called on: app foreground, network reconnect, and right after a game finishes.
 */
export async function flush(now: Date): Promise<FlushOutcome> {
  const db = await getDb();
  const iso = now.toISOString();

  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM outbox
     WHERE next_try_at IS NULL OR next_try_at <= ?
     ORDER BY created_at
     LIMIT ?`,
    iso,
    BATCH,
  );

  if (rows.length === 0) return { sent: 0, recorded: 0, duplicates: 0, remaining: await pendingCount() };

  const parsed = rows.map(parse);
  // A row whose JSON will not parse can never succeed. Drop it rather than blocking the queue
  // behind it forever — this should be impossible, but a permanently stuck queue is worse.
  const corrupt = rows.filter((_, i) => parsed[i] === null).map((r) => r.client_id);
  for (const id of corrupt) await db.runAsync('DELETE FROM outbox WHERE client_id = ?', id);

  const usable = parsed.filter((p): p is NonNullable<typeof p> => p !== null);
  if (usable.length === 0) {
    return { sent: 0, recorded: 0, duplicates: 0, remaining: await pendingCount() };
  }

  try {
    const res = await api.flashcards.recordResults({ results: usable.map((u) => u.payload) });

    // Confirmed 2xx — and only now.
    await db.withTransactionAsync(async () => {
      for (const u of usable) {
        await db.runAsync('DELETE FROM outbox WHERE client_id = ?', u.clientId);
      }
    });

    return {
      sent: usable.length,
      recorded: res.recorded,
      duplicates: res.duplicates,
      remaining: await pendingCount(),
      outcomes: (res.outcomes ?? []).filter(
        (o): o is { clientId: string; garden: GardenOutcome | null } => o.clientId !== null,
      ),
    };
  } catch (err) {
    // 422 means the server will never accept this payload — a client bug or a stale schema.
    // Retrying forever would wedge the queue, so those rows are dropped; everything else
    // (offline, timeout, 401, 5xx) is retried with backoff and the rows are KEPT.
    const permanent = err instanceof ApiError && err.status === 422;

    for (const u of usable) {
      if (permanent) {
        await db.runAsync('DELETE FROM outbox WHERE client_id = ?', u.clientId);
        continue;
      }
      const row = rows.find((r) => r.client_id === u.clientId)!;
      const attempts = row.attempts + 1;
      const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
      await db.runAsync(
        'UPDATE outbox SET attempts = ?, next_try_at = ? WHERE client_id = ?',
        attempts,
        new Date(now.getTime() + wait).toISOString(),
        u.clientId,
      );
    }

    return {
      sent: 0,
      recorded: 0,
      duplicates: 0,
      remaining: await pendingCount(),
      error: err instanceof ApiError ? err.messageKey : 'err_generic_msg',
    };
  }
}
