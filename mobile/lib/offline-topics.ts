import { getDb } from './db';
import * as api from './endpoints';
import type { TopicBundle } from './types';

/**
 * The read path: topics the user has explicitly downloaded for offline study.
 *
 * **Explicit, never magic.** Downloading is a toggle on each topic card. Students on metered
 * Vietnamese mobile data decide what to spend it on — an app that silently syncs everything is
 * an app that costs them money.
 */

export interface OfflineTopicMeta {
  topicId: string;
  slug: string;
  syncedAt: string;
}

interface Row {
  topic_id: string;
  slug: string;
  payload: string;
  synced_at: string;
}

/** Which topics are downloaded, and when each was last refreshed. */
export async function listDownloaded(): Promise<OfflineTopicMeta[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<Row, 'payload'>>(
    'SELECT topic_id, slug, synced_at FROM offline_topics',
  );
  return rows.map((r) => ({ topicId: r.topic_id, slug: r.slug, syncedAt: r.synced_at }));
}

export async function readTopic(
  slug: string,
): Promise<{ bundle: TopicBundle; syncedAt: string } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM offline_topics WHERE slug = ?', slug);
  if (!row) return null;
  try {
    return { bundle: JSON.parse(row.payload) as TopicBundle, syncedAt: row.synced_at };
  } catch {
    // Corrupt JSON is unrecoverable and not worth keeping. Drop it so the next online open
    // re-downloads cleanly rather than failing forever.
    await db.runAsync('DELETE FROM offline_topics WHERE slug = ?', slug);
    return null;
  }
}

/** Stores (or replaces) a topic. `syncedAt` is stamped by the caller so tests can control it. */
export async function saveTopic(bundle: TopicBundle, syncedAt: string): Promise<void> {
  const db = await getDb();
  const slug = bundle.topic.slug ?? bundle.topic.id;
  await db.runAsync(
    `INSERT INTO offline_topics (topic_id, slug, payload, synced_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(topic_id) DO UPDATE SET slug = excluded.slug, payload = excluded.payload,
                                        synced_at = excluded.synced_at`,
    bundle.topic.id,
    slug,
    JSON.stringify(bundle),
    syncedAt,
  );
}

export async function removeTopic(topicId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM offline_topics WHERE topic_id = ?', topicId);
}

/** Fetch from the network and store. Used by the download toggle and by the silent refresh. */
export async function downloadTopic(slug: string, now: Date): Promise<TopicBundle> {
  const bundle = await api.flashcards.topic(slug);
  await saveTopic(bundle, now.toISOString());
  return bundle;
}

/**
 * Silently re-download everything already downloaded. Called when the app is foregrounded and
 * online — a student who downloaded a topic last week should not study last week's words.
 *
 * Failures are swallowed per topic: this is a background nicety, and the stored copy stays
 * usable. A partial refresh is strictly better than an all-or-nothing one.
 */
export async function refreshDownloaded(now: Date): Promise<number> {
  const downloaded = await listDownloaded();
  let refreshed = 0;
  for (const meta of downloaded) {
    try {
      await downloadTopic(meta.slug, now);
      refreshed++;
    } catch {
      /* keep the stored copy */
    }
  }
  return refreshed;
}
