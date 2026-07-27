import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/flashcards';
import { FlashcardResultBatch } from '../../shared/schemas';

/**
 * Record completed games. `user` level — students are the main players.
 *
 * Always a batch, so the mobile offline outbox can flush several at once. Each result
 * carries an optional device-generated `clientId`; replaying one already recorded is a
 * silent no-op, which is what lets the outbox retry blindly after a dropped response.
 */
export const action = withAuth('user', async ({ request, db, user }) => {
  const { results } = await parseBody(request, FlashcardResultBatch);
  const recorded = await svc.recordResults(db, { kind: user.kind, id: user.user.id }, results);
  return { received: results.length, recorded, duplicates: results.length - recorded };
});
